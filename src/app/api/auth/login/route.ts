import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  SESSION_COOKIE,
  checkLoginRateLimit,
  clearLoginRateLimit,
  clientIp,
  createSession,
  ensureDevAccounts,
  isSecureRequest,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/cloak/server/auth";
import { entitlementForUser } from "@/lib/cloak/server/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  handle: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
  // Dagger device registry binding (dagger codex §16)
  deviceId: z.string().min(8).max(128).optional(),
  deviceName: z.string().min(1).max(64).optional(),
  deviceToken: z.string().min(16).max(128).optional(),
});

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = checkLoginRateLimit(ip);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  let parsedBody: z.infer<typeof bodySchema>;
  try {
    parsedBody = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  /* Accept "@Aurora", "aurora", "@aurora " alike. */
  const handle = parsedBody.handle.trim().replace(/^@+/, "").toLowerCase();
  const password = parsedBody.password;

  await ensureDevAccounts();

  try {
    const user = await db.user.findUnique({ where: { handle } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
    }

    clearLoginRateLimit(ip);
    const { token } = await createSession(
      user.id,
      parsedBody.deviceId,
      parsedBody.deviceName,
      parsedBody.deviceToken
    );

    /* Server-authoritative entitlement: the User row is the truth; the dev
     * fallback inside entitlementForUser keeps seeded test identities in
     * until launch (CLOAK_ALLOW_DEV_ACTIVATION). */
    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        handle: user.handle,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        displayName: user.displayName,
        about: user.about,
      },
      membership: entitlementForUser(user),
    });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(isSecureRequest(req)));
    return res;
  } catch (err) {
    console.error("[auth/login] failed:", err);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

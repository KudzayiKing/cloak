import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { RateLimitBuckets } from "@/lib/cloak/rate-limit";
import {
  SESSION_COOKIE,
  clientIp,
  getSessionUser,
  isSecureRequest,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/cloak/server/auth";
import { deleteUserAccount } from "@/lib/cloak/server/account-lifecycle";
import { requireSameOrigin } from "@/lib/cloak/server/adviser-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Account erasure. Irreversible, so it is guarded three ways beyond the
 * session cookie:
 *
 *   1. same-origin (a cross-site form post cannot reach it);
 *   2. the handle typed back, which defeats a mis-click;
 *   3. the account PASSWORD re-verified — a stolen session, or an
 *      unattended unlocked device, must not be enough to destroy the
 *      account. This is the same reasoning as a bank requiring a PIN for a
 *      transfer rather than trusting the open app.
 *
 * The rate limit exists because each attempt costs a scrypt verification
 * plus (on success) a 30 s-budgeted transaction.
 */
const DELETION_WINDOW_MS = 15 * 60 * 1000;
const DELETION_MAX_ATTEMPTS = 5;
const deletionAttempts = new RateLimitBuckets();

const deleteSchema = z.object({
  /** The account handle typed by hand. The leading "@" is tolerated. */
  confirmHandle: z.string().min(1).max(64),
  password: z.string().min(1).max(1024),
});

function noStore(extra?: HeadersInit): HeadersInit {
  return { "Cache-Control": "no-store, max-age=0", ...extra };
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401, headers: noStore() });
  }
  if (!requireSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403, headers: noStore() });
  }

  const limit = deletionAttempts.take(
    `delete:${clientIp(req)}:${user.id}`,
    DELETION_MAX_ATTEMPTS,
    DELETION_WINDOW_MS
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: noStore({ "Retry-After": String(limit.retryAfterSec) }) }
    );
  }

  let body: z.infer<typeof deleteSchema>;
  try {
    body = deleteSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400, headers: noStore() });
  }

  const typed = body.confirmHandle.replace(/^@/, "").trim().toLowerCase();
  if (typed !== user.handle.toLowerCase()) {
    return NextResponse.json({ ok: false, error: "handle_mismatch" }, { status: 400, headers: noStore() });
  }

  /* `SessionUser` deliberately carries no credential, so re-read just the
     hash for the password check. */
  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!record) {
    /* The account vanished between the cookie check and here. */
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404, headers: noStore() });
  }
  if (!(await verifyPassword(body.password, record.passwordHash))) {
    return NextResponse.json({ ok: false, error: "bad_password" }, { status: 403, headers: noStore() });
  }

  let summary: Awaited<ReturnType<typeof deleteUserAccount>>;
  try {
    summary = await deleteUserAccount(user.id);
  } catch (err) {
    const error = err instanceof Error ? err.message : "server_error";
    const status = error === "user_not_found" ? 404 : 500;
    return NextResponse.json({ ok: false, error }, { status, headers: noStore() });
  }

  /* The session row is already gone; the surviving cookie is a dead
     credential, but leaving it means every subsequent request pays a lookup
     to learn that. Expire it explicitly. */
  const res = NextResponse.json({ ok: true, summary }, { headers: noStore() });
  res.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(isSecureRequest(req)),
    maxAge: 0,
  });
  return res;
}

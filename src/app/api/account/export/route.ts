import { NextRequest, NextResponse } from "next/server";
import { RateLimitBuckets } from "@/lib/cloak/rate-limit";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { exportUserData } from "@/lib/cloak/server/account-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Data portability (GDPR art. 20 / CCPA "right to know").
 *
 * A GET is safe here without a same-origin check: a cross-site request
 * cannot READ the body (no CORS headers are emitted), and the endpoint
 * changes nothing. The bucket is per-account because the query fans out
 * across every relation the account touches.
 */
const EXPORT_WINDOW_MS = 60 * 60 * 1000;
const EXPORT_MAX = 10;
const exportAttempts = new RateLimitBuckets();

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "unauthenticated" },
      { status: 401, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  const limit = exportAttempts.take(`export:${user.id}`, EXPORT_MAX, EXPORT_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: limit.retryAfterSec },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Retry-After": String(limit.retryAfterSec),
        },
      }
    );
  }

  let data: Awaited<ReturnType<typeof exportUserData>>;
  try {
    data = await exportUserData(user.id);
  } catch (err) {
    /* Do not collapse every failure into 404 — a query error would then read
       as "no such account", which is both wrong and unactionable. */
    const missing = err instanceof Error && err.message === "user_not_found";
    return NextResponse.json(
      { ok: false, error: missing ? "user_not_found" : "export_failed" },
      { status: missing ? 404 : 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      /* The browser saves it rather than rendering JSON in a tab. */
      "Content-Disposition": `attachment; filename="cloak-${user.handle}-${stamp}.json"`,
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

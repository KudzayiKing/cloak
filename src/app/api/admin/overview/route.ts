import { NextRequest, NextResponse } from "next/server";
import { clientIp, getSessionUser } from "@/lib/cloak/server/auth";
import { adviserNoStoreHeaders, isAdminUser } from "@/lib/cloak/server/adviser-invitations";
import { checkOverviewRateLimit, getAdminOverview } from "@/lib/cloak/server/admin-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Aggregate-only operational counts (GET).
 *
 * The authorization decision is re-made here rather than inherited from the
 * page that links to it: `isAdminUser` is a *doorway, not a gate* — hiding a
 * navigation item is not authorization, so every `/api/admin/*` route decides
 * for itself. That is the same predicate the page uses, so the two cannot
 * disagree about who is an operator.
 *
 * There is no POST/PATCH/DELETE counterpart and there will not be one: the
 * panel is read-only by design, because entitlements come only from payment
 * verification and invite redemption, and account removal belongs to the
 * account holder. `verify-admin-overview.mts` asserts the absence.
 *
 * `requireSameOrigin` is deliberately not called — it guards state-changing
 * requests, and this one changes nothing. Same reasoning as the GET beside it
 * in `/api/admin/adviser-invitations`.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user || !isAdminUser(user)) {
    return NextResponse.json(
      { ok: false, error: user ? "forbidden" : "unauthenticated" },
      { status: user ? 403 : 401, headers: adviserNoStoreHeaders() }
    );
  }

  const limit = checkOverviewRateLimit(`overview:${clientIp(req)}:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: limit.retryAfterSec },
      {
        status: 429,
        headers: adviserNoStoreHeaders({ "Retry-After": String(limit.retryAfterSec) }),
      }
    );
  }

  return NextResponse.json(
    { ok: true, overview: await getAdminOverview() },
    { headers: adviserNoStoreHeaders() }
  );
}

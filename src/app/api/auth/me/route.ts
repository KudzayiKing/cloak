import { NextRequest, NextResponse } from "next/server";
import { ensureDevAccounts, getSessionUser } from "@/lib/cloak/server/auth";
import { isAdminUser } from "@/lib/cloak/server/adviser-invitations";
import { entitlementForUser } from "@/lib/cloak/server/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  await ensureDevAccounts();
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  /* `isAdmin` decides whether Settings shows the admin entry. It is recomputed
     from server env on every request and is never persisted, so removing an
     allowlist entry takes effect at the next hydration. It reveals a fact about
     the caller's own session only, and is NOT a capability grant — every
     /api/admin/* route re-checks with the same predicate (spec §4). */
  return NextResponse.json({
    ok: true,
    user,
    membership: entitlementForUser(user),
    isAdmin: isAdminUser(user),
  });
}

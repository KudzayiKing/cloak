import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  adviserNoStoreHeaders,
  getAdviserInvitation,
  isAdminUser,
} from "@/lib/cloak/server/adviser-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/adviser-invitations/[id]
 *
 * Admin-only detail read (spec §32 "View Details", §43 getAdviserInvitation).
 * Returns the invitation and its audit trail; never the token hash. Answers
 * 404 for an unknown id rather than 403 so the route does not confirm which
 * ids exist to a caller who has already been rejected.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req);
  if (!user || !isAdminUser(user)) {
    return NextResponse.json(
      { ok: false, error: user ? "forbidden" : "unauthenticated" },
      { status: user ? 403 : 401, headers: adviserNoStoreHeaders() }
    );
  }
  const { id } = await params;
  const invitation = await getAdviserInvitation(id);
  if (!invitation) {
    return NextResponse.json(
      { ok: false, error: "not_found" },
      { status: 404, headers: adviserNoStoreHeaders() }
    );
  }
  return NextResponse.json({ ok: true, invitation }, { headers: adviserNoStoreHeaders() });
}

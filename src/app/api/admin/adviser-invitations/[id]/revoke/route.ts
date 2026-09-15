import { NextRequest, NextResponse } from "next/server";
import { clientIp, getSessionUser } from "@/lib/cloak/server/auth";
import {
  adviserNoStoreHeaders,
  checkInviteRateLimit,
  isAdminUser,
  requireSameOrigin,
  revokeAdviserInvitation,
} from "@/lib/cloak/server/adviser-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(req);
  if (!user || !isAdminUser(user)) {
    return NextResponse.json({ ok: false, error: user ? "forbidden" : "unauthenticated" }, { status: user ? 403 : 401, headers: adviserNoStoreHeaders() });
  }
  if (!requireSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403, headers: adviserNoStoreHeaders() });
  }
  const limit = checkInviteRateLimit(`admin:${clientIp(req)}:${user.id}`);
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429, headers: adviserNoStoreHeaders({ "Retry-After": String(limit.retryAfterSec) }) });
  }
  const { id } = await params;
  try {
    const invitation = await revokeAdviserInvitation(id, user.id);
    return NextResponse.json({ ok: true, invitation }, { headers: adviserNoStoreHeaders() });
  } catch (err) {
    const error = err instanceof Error ? err.message : "server_error";
    return NextResponse.json({ ok: false, error }, { status: error === "not_pending" ? 409 : 500, headers: adviserNoStoreHeaders() });
  }
}

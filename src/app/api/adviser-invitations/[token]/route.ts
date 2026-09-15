import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/cloak/server/auth";
import {
  adviserNoStoreHeaders,
  checkInviteRateLimit,
  getAdviserInvitationByToken,
} from "@/lib/cloak/server/adviser-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limit = checkInviteRateLimit(`lookup:${clientIp(req)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: adviserNoStoreHeaders({ "Retry-After": String(limit.retryAfterSec) }) }
    );
  }
  const { token } = await params;
  const invitation = await getAdviserInvitationByToken(token);
  return NextResponse.json({ ok: true, invitation }, { headers: adviserNoStoreHeaders() });
}

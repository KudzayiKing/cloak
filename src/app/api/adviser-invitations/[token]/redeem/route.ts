import { NextRequest, NextResponse } from "next/server";
import { clientIp, getSessionUser } from "@/lib/cloak/server/auth";
import {
  adviserNoStoreHeaders,
  checkInviteRateLimit,
  redeemAdviserInvitation,
  requireSameOrigin,
} from "@/lib/cloak/server/adviser-invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!requireSameOrigin(req)) {
    return NextResponse.json({ ok: false, error: "bad_origin" }, { status: 403, headers: adviserNoStoreHeaders() });
  }
  const limit = checkInviteRateLimit(`redeem:${clientIp(req)}`);
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      { status: 429, headers: adviserNoStoreHeaders({ "Retry-After": String(limit.retryAfterSec) }) }
    );
  }
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401, headers: adviserNoStoreHeaders() });
  }
  let body: { email?: string } = {};
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    body = {};
  }
  const { token } = await params;
  const result = await redeemAdviserInvitation({ token, userId: user.id, email: body.email });
  if (!result.ok) {
    const status =
      result.error === "unauthenticated" ? 401 :
      result.error.startsWith("recipient_already") ||
      result.error.startsWith("already_") ||
      result.error === "email_binding_required" ||
      result.error === "email_already_used" ? 409 : 404;
    return NextResponse.json(result, { status, headers: adviserNoStoreHeaders() });
  }
  return NextResponse.json(result, { headers: adviserNoStoreHeaders() });
}

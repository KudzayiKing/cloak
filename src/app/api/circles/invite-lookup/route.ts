import { NextRequest, NextResponse } from "next/server";
import { lookupCircleInvite } from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public invite lookup — deliberately NO session requirement (§40: the
 *  token IS the capability). Returns only what the recipient needs to
 *  decide: circle name, inviter display name, groups offered, status.
 *  Never member data or counts (§42/§48). */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!token || token.length > 200) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const lookup = await lookupCircleInvite(token);
  if (!lookup) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, ...lookup });
}

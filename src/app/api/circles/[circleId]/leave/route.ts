import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { CircleOperationError, leaveCircle } from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Leave the circle (spec §77): shell access revoked, circle groups left,
 *  independent Cloak membership and unrelated chats untouched. An owner
 *  with other members must transfer ownership first. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  try {
    await leaveCircle(circleId, user.id, user.displayName);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  CircleOperationError,
  deleteCircle,
  loadCircleDetail,
} from "@/lib/cloak/server/circles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Circle screen payload (spec §29/§42/§55/§68). Access follows the §26
 *  model: active circle members only; groups/directory filtered by role. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  const circle = await loadCircleDetail(circleId, user.id);
  if (!circle) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, circle });
}

/** Delete the circle structure (spec §46): owner-only; groups are detached,
 *  never destroyed; invites die; membership rows go with the structure.
 *  The client confirms by typing the circle name — the server enforces
 *  ownership, the typed confirmation is the human guard. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ circleId: string }> }
) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { circleId } = await params;
  try {
    await deleteCircle(circleId, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CircleOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

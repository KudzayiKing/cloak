import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  GroupOperationError,
  canGroup,
  removeMember,
  roleOf,
} from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

/** Remove a member (invite/remove permission required; owners are protected). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId, userId: targetUserId } = await params;
  const mine = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!mine || mine.removedAt || !canGroup(roleOf(mine.role), "group.member.remove")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (targetUserId === user.id) {
    return NextResponse.json({ ok: false, error: "use_leave" }, { status: 400 });
  }

  try {
    await removeMember({
      conversationId,
      actorId: user.id,
      actorName: user.displayName,
      targetUserId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof GroupOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

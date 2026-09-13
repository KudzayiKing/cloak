import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { canGroup, roleOf } from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; inviteId: string }> };

/** Revoke an invite (spec: invite revocation). */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId, inviteId } = await params;
  const mine = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!mine || mine.removedAt || !canGroup(roleOf(mine.role), "group.invite.manage")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const invite = await db.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.conversationId !== conversationId) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  await db.groupInvite.update({
    where: { id: inviteId },
    data: { status: "revoked", revokedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { hashInviteToken, inviteEffectiveStatus } from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * Invite preview for the redemption screen (groups spec §9-§10).
 * Reveals the minimum: group name, owner, member count, invite state.
 * Auth required — invite links are not a discovery mechanism.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { token } = await params;
  const invite = await db.groupInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: {
      conversation: {
        include: { participations: { where: { removedAt: null }, select: { userId: true } } },
      },
    },
  });
  if (!invite) {
    return NextResponse.json({ ok: false, error: "unknown_token" }, { status: 404 });
  }

  const status = inviteEffectiveStatus(invite);
  const owner = invite.conversation.ownerId
    ? await db.user.findUnique({ where: { id: invite.conversation.ownerId } })
    : null;
  const alreadyMember = invite.conversation.participations.some((p) => p.userId === user.id);

  return NextResponse.json({
    ok: true,
    invite: {
      groupName: invite.conversation.title ?? "Private group",
      groupDescription: invite.conversation.description ?? undefined,
      ownerName: owner?.displayName ?? "A member",
      memberCount: invite.conversation.participations.length,
      status,
      requiresApproval: invite.requiresApproval,
      expiresAt: invite.expiresAt?.getTime() ?? null,
    },
    alreadyMember,
  });
}

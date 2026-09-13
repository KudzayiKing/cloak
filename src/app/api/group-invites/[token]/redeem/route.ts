import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { isBlockedBy } from "@/lib/cloak/server/blocks";
import {
  GroupOperationError,
  hashInviteToken,
  inviteEffectiveStatus,
  joinThroughInvite,
} from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/** Redeem an invite: join immediately, or file a join request (spec §10). */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { token } = await params;

  try {
    const invite = await db.groupInvite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
    });
    if (!invite) {
      return NextResponse.json({ ok: false, error: "unknown_token" }, { status: 404 });
    }
    const status = inviteEffectiveStatus(invite);
    if (status !== "active") {
      return NextResponse.json({ ok: false, error: `invite_${status}` }, { status: 400 });
    }

    /* §75: a blocked relation in either direction voids the link. The
       refusal reuses the generic inactive code — block state is never
       exposed to the blocked user. */
    if (
      (await isBlockedBy(user.id, invite.createdByUserId)) ||
      (await isBlockedBy(invite.createdByUserId, user.id))
    ) {
      return NextResponse.json({ ok: false, error: "invite_not_active" }, { status: 400 });
    }

    const result = await joinThroughInvite({
      invite: { id: invite.id, conversationId: invite.conversationId, requiresApproval: invite.requiresApproval },
      userId: user.id,
      userName: user.displayName,
    });

    if (result === "joined") {
      return NextResponse.json({ ok: true, result: "joined", conversationId: invite.conversationId });
    }
    return NextResponse.json({ ok: true, result: "requested" });
  } catch (err) {
    if (err instanceof GroupOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

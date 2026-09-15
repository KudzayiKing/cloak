import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { loadConversationDetail } from "@/lib/cloak/server/conversations";
import {
  GroupOperationError,
  addMembers,
  canGroup,
  mapMembers,
  resolveHandles,
  roleOf,
  expireStaleInvites,
  type GroupMemberPayload,
  type GroupJoinRequestPayload,
} from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Group membership surface.
 * GET    -> members + my role (+ pending join requests for admins/owner)
 * POST   -> add members by Cloaq ID (invite permission required)
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  const mine = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!mine || mine.removedAt) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { participations: { include: { user: true } } },
  });
  if (!conv) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const myRole = roleOf(mine.role);
  const canManage = canGroup(myRole, "group.member.approve");
  const pending = canManage
    ? await db.groupJoinRequest.findMany({
        where: { conversationId, status: "pending" },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const pendingRequests: GroupJoinRequestPayload[] = pending.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.user.displayName,
    cloakId: `@${r.user.handle}`,
    avatarInitials: r.user.displayName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join(""),
    createdAt: r.createdAt.getTime(),
  }));

  return NextResponse.json({
    ok: true,
    members: mapMembers(
      conv.participations.filter((p) => !p.removedAt),
      user.id
    ),
    myRole,
    pendingRequests,
  });
}

const addSchema = z.object({
  handles: z.array(z.string().max(64)).min(1).max(50),
});

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  const mine = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!mine || mine.removedAt || !canGroup(roleOf(mine.role), "group.member.invite")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let body: z.infer<typeof addSchema>;
  try {
    body = addSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    const { users, unknown } = await resolveHandles(body.handles);
    await addMembers({
      conversationId,
      actorId: user.id,
      actorName: user.displayName,
      userIds: users.map((u) => u.id),
    });
    const conv = await db.conversation.findUnique({
      where: { id: conversationId },
      include: { participations: { include: { user: true } } },
    });
    const members: GroupMemberPayload[] = conv
      ? mapMembers(conv.participations.filter((p) => !p.removedAt), user.id)
      : [];
    return NextResponse.json({ ok: true, members, unknownHandles: unknown });
  } catch (err) {
    if (err instanceof GroupOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

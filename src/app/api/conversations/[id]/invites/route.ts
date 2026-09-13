import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import {
  GroupOperationError,
  canGroup,
  createGroupInvite,
  expireStaleInvites,
  inviteEffectiveStatus,
  roleOf,
} from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** List active invites for this group (invite management permission). */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  const mine = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!mine || mine.removedAt || !canGroup(roleOf(mine.role), "group.invite.manage")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  await expireStaleInvites(conversationId);
  const invites = await db.groupInvite.findMany({
    where: { conversationId, status: "active" },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    ok: true,
    invites: invites.map((i) => ({
      id: i.id,
      type: i.type,
      status: inviteEffectiveStatus(i),
      maxUses: i.maxUses,
      useCount: i.useCount,
      requiresApproval: i.requiresApproval,
      expiresAt: i.expiresAt?.getTime() ?? null,
      createdAt: i.createdAt.getTime(),
    })),
  });
}

const createSchema = z.object({
  type: z.enum(["link", "qr", "single_use"]).optional(),
  maxUses: z.number().int().min(1).max(500).nullable().optional(),
  expiresInDays: z.number().min(0).max(365).nullable().optional(),
  requiresApproval: z.boolean().optional(),
});

/** Create an invite; the raw token exists only in this response. */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  const mine = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!mine || mine.removedAt || !canGroup(roleOf(mine.role), "group.invite.manage")) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    const { invite, token } = await createGroupInvite({
      conversationId,
      createdByUserId: user.id,
      type: body.type,
      maxUses: body.maxUses ?? null,
      expiresInDays: body.expiresInDays ?? null,
      requiresApproval: body.requiresApproval ?? false,
    });
    return NextResponse.json({
      ok: true,
      invite: {
        id: invite.id,
        type: invite.type,
        status: "active" as const,
        maxUses: invite.maxUses,
        useCount: 0,
        requiresApproval: invite.requiresApproval,
        expiresAt: invite.expiresAt?.getTime() ?? null,
        createdAt: invite.createdAt.getTime(),
        token,
      },
    });
  } catch (err) {
    if (err instanceof GroupOperationError) {
      return NextResponse.json({ ok: false, error: err.code }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

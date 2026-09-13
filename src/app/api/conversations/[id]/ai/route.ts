import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { canGroup, roleOf } from "@/lib/cloak/server/groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const aiSchema = z.object({ allowed: z.boolean() });

/**
 * Set the group's OWN AI permission (spec §64) — server truth, replacing
 * the previous client-local toggle. Groups: the owner decides
 * (group.settings.manage). 1:1 chats: either participant decides for the
 * shared row. The EFFECTIVE access is the strictest of this value and the
 * Circle's policy (§39) — a group can never weaken a Circle restriction.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  let body: z.infer<typeof aiSchema>;
  try {
    body = aiSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const mine = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
  });
  if (!mine || mine.removedAt) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const conv = await db.conversation.findUnique({
    where: { id: conversationId },
    include: { circle: { select: { aiDefault: true } } },
  });
  if (!conv) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  if (conv.isGroup) {
    if (!canGroup(roleOf(mine.role), "group.settings.manage")) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  const aiAccess = body.allowed ? "allowed" : "blocked";
  await db.conversation.update({ where: { id: conversationId }, data: { aiAccess } });

  const circleDefault = conv.circle?.aiDefault;
  let aiEffective: "allowed" | "limited" | "blocked" = aiAccess;
  if (aiEffective === "allowed" && circleDefault === "disabled") aiEffective = "blocked";
  else if (aiEffective === "allowed" && circleDefault === "current_request") aiEffective = "limited";

  return NextResponse.json({ ok: true, aiAccess, aiEffective, aiCircleDefault: circleDefault ?? null });
}

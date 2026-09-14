import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { CLOAK_REACTION_IDS } from "@/lib/cloak/reactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; messageId: string }> };

const bodySchema = z.object({
  emoji: z.string().min(1).max(64),
});

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }

  const { id: conversationId, messageId } = await params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  if (!CLOAK_REACTION_IDS.has(body.emoji)) {
    return NextResponse.json({ ok: false, error: "unknown_reaction" }, { status: 400 });
  }

  const message = await db.message.findFirst({
    where: {
      id: messageId,
      conversationId,
      conversation: { participations: { some: { userId: user.id, removedAt: null } } },
    },
    select: { id: true },
  });
  if (!message) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const existing = await db.messageReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: user.id, emoji: body.emoji } },
  });

  if (existing) {
    await db.messageReaction.delete({ where: { id: existing.id } });
  } else {
    await db.messageReaction.create({
      data: { messageId, userId: user.id, emoji: body.emoji },
    });
  }

  const rows = await db.messageReaction.findMany({
    where: { messageId },
    select: { emoji: true, userId: true },
  });
  const byEmoji = new Map<string, { emoji: string; count: number; mine?: boolean }>();
  for (const row of rows) {
    const summary = byEmoji.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    summary.count += 1;
    if (row.userId === user.id) summary.mine = true;
    byEmoji.set(row.emoji, summary);
  }

  return NextResponse.json({
    ok: true,
    reactions: [...byEmoji.values()].sort((a, b) => b.count - a.count),
  });
}

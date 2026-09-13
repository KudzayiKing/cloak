import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { isParticipant, purgeExpiredMessages, GHOST_SECONDS_ALLOWED } from "@/lib/cloak/server/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const ghostSchema = z.object({
  /** 0 turns ghost mode off; otherwise a TTL in seconds. */
  seconds: z.number().int().refine((s) => (GHOST_SECONDS_ALLOWED as readonly number[]).includes(s)),
});

/**
 * POST /api/conversations/[id]/ghost — turn Ghost chat on/off for a
 * conversation. Any participant may toggle it; the change applies to
 * messages sent from now on (existing history is untouched until its
 * own timer, if any, runs out).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  let parsed: z.infer<typeof ghostSchema>;
  try {
    parsed = ghostSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  const conversation = await db.conversation.update({
    where: { id: conversationId },
    data: { ghostSeconds: parsed.seconds > 0 ? parsed.seconds : null },
    select: { ghostSeconds: true },
  });

  await purgeExpiredMessages();

  return NextResponse.json({ ok: true, ghostSeconds: conversation.ghostSeconds ?? null });
}

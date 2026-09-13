import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { isParticipant, mapMessage, purgeExpiredMessages } from "@/lib/cloak/server/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Sync + pagination endpoint.
 * GET   ?since=<epoch ms>  -> messages created at/after the cursor
 *                                 (dedup by id client-side), ascending.
 * GET   ?before=<epoch ms> -> one OLDER page: messages strictly before the
 *                                 cursor, newest-first window, ascending.
 *                                 Used by "load earlier messages".
 * GET   ?limit=<1..200>    -> window size (default 200).
 * GET   (no cursor)        -> current history window (newest `limit`).
 * Response carries hasMore (older messages exist beyond this page) so the
 * client knows when to stop paginating. Each sync marks the caller's
 * delivery marker so 1:1 peers see ticks. Group messages stay "sent" —
 * per-group read receipts ship later. The caller's new-member history
 * window (historyFrom) applies to every mode.
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

  /* Ghost chats: messages whose timer ran out vanish on access. */
  await purgeExpiredMessages();

  const sinceParam = req.nextUrl.searchParams.get("since");
  const beforeParam = req.nextUrl.searchParams.get("before");
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "200");
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), 200)
    : 200;
  const since = sinceParam ? Number(sinceParam) : NaN;
  const before = beforeParam ? Number(beforeParam) : NaN;
  const incremental = Number.isFinite(since) && since >= 0;
  const paginating = Number.isFinite(before) && before >= 0;

  /* Lower bound: new-member history window, and the incremental cursor. */
  const gte = incremental
    ? [mine.historyFrom, new Date(since)]
        .filter((d): d is Date => d instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    : mine.historyFrom;

  /* Upper bound for older-page fetches (strictly before the cursor). */
  const lt = paginating ? new Date(before) : null;
  const createdAt =
    gte || lt ? { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } : undefined;

  /* limit + 1 probe row answers hasMore without a second count query. */
  const rows = await db.message.findMany({
    where: { conversationId, ...(createdAt ? { createdAt } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: { author: true },
  });
  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).reverse(); // window, ascending

  /* Receiving messages counts as delivery for this participant. */
  await db.participation.updateMany({
    where: { conversationId, userId: user.id },
    data: { lastDeliveredAt: new Date() },
  });

  const isGroup = (await db.conversation.findUnique({
    where: { id: conversationId },
    select: { isGroup: true },
  }))?.isGroup ?? false;

  /* 1:1 tick source; groups keep the honest "sent" state. */
  const participations = await db.participation.findMany({
    where: { conversationId, removedAt: null },
  });
  const peer = isGroup ? undefined : participations.find((p) => p.userId !== user.id);

  return NextResponse.json({
    ok: true,
    messages: messages.map((m) =>
      mapMessage(m, user.id, peer?.lastReadAt ?? null, peer?.lastDeliveredAt ?? null)
    ),
    hasMore,
    peerLastReadAt: peer?.lastReadAt ? peer.lastReadAt.getTime() : null,
  });
}

const USER_MESSAGE_KINDS = ["text", "file", "image", "voice", "view-once"] as const;
const base64ish = /^[A-Za-z0-9+/=_-]+$/;

const encryptedEnvelopeSchema = z.object({
  v: z.number().int().min(1).max(1000),
  k: z.string().min(1).max(512).regex(base64ish).optional(),
  n: z.string().min(12).max(512).regex(base64ish),
  c: z.string().min(1).max(12000).regex(base64ish),
}).strict();

const sendSchema = z.object({
  /* E2EE: user-authored messages must arrive as the client-encrypted
     envelope JSON. Server-created system notices are written internally. */
  body: z.string().min(1).max(14000).superRefine((body, ctx) => {
    try {
      encryptedEnvelopeSchema.parse(JSON.parse(body));
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "body must be an encrypted message envelope",
      });
    }
  }),
  kind: z.enum(USER_MESSAGE_KINDS).default("text"),
});

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  if (!(await isParticipant(conversationId, user.id))) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  let parsed: z.infer<typeof sendSchema>;
  try {
    parsed = sendSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  /* Ghost chats: message TTL is stamped from the conversation's current
     mode at send time. Changing the mode later only affects new messages. */
  const convMode = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { ghostSeconds: true },
  });
  const ghostSeconds = convMode?.ghostSeconds ?? null;

  const created = await db.message.create({
    data: {
      conversationId,
      authorId: user.id,
      kind: parsed.kind,
      body: parsed.body,
      ...(ghostSeconds ? { expiresAt: new Date(Date.now() + ghostSeconds * 1000) } : {}),
    },
    include: { author: true },
  });
  await db.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  const isGroup = (await db.conversation.findUnique({
    where: { id: conversationId },
    select: { isGroup: true },
  }))?.isGroup ?? false;
  const peer = isGroup
    ? undefined
    : await db.participation.findFirst({
        where: { conversationId, removedAt: null, userId: { not: user.id } },
      });

  return NextResponse.json({
    ok: true,
    message: mapMessage(created, user.id, peer?.lastReadAt ?? null, peer?.lastDeliveredAt ?? null),
    ghostSeconds,
  });
}

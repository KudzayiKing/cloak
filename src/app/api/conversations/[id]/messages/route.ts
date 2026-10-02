import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/cloak/server/auth";
import { mapMessage, purgeExpiredMessages } from "@/lib/cloak/server/conversations";
import { notifyNewMessage } from "@/lib/cloak/server/notify";

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
  const conversation = await db.conversation.findFirst({
    where: {
      id: conversationId,
      participations: { some: { userId: user.id, removedAt: null } },
    },
    select: {
      isGroup: true,
      participations: {
        where: { removedAt: null },
        select: {
          userId: true,
          lastReadAt: true,
          lastDeliveredAt: true,
          historyFrom: true,
        },
      },
    },
  });
  const mine = conversation?.participations.find((p) => p.userId === user.id);
  if (!conversation || !mine) {
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
    include: { author: true, reactions: { select: { emoji: true, userId: true } } },
  });
  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).reverse(); // window, ascending

  /* Receiving messages counts as delivery for this participant. */
  await db.participation.updateMany({
    where: { conversationId, userId: user.id },
    data: { lastDeliveredAt: new Date() },
  });

  /* 1:1 tick source; groups keep the honest "sent" state. */
  const peer = conversation.isGroup
    ? undefined
    : conversation.participations.find((p) => p.userId !== user.id);

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
  /* Idempotency key, minted by the sending client. Optional so older clients
     (and any non-outbox caller) keep working unchanged. Bounded and
     character-restricted because it goes into a unique index and is echoed
     back in conflict responses. */
  clientKey: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});

/** The unique index on Message.clientKey is the only constraint a replay can
 *  realistically trip, so a P2002 here means "another attempt won the race". */
function isClientKeyCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: string; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") return false;
  const target = candidate.meta?.target;
  if (Array.isArray(target)) return target.includes("clientKey");
  if (typeof target === "string") return target.includes("clientKey");
  /* Older Prisma builds omit the target; clientKey is the only plausible one. */
  return true;
}

export async function POST(req: NextRequest, { params }: Params) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const { id: conversationId } = await params;
  let parsed: z.infer<typeof sendSchema>;
  try {
    parsed = sendSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  /* Ghost chats: message TTL is stamped from the conversation's current
     mode at send time. Changing the mode later only affects new messages. */
  const conversation = await db.conversation.findFirst({
    where: {
      id: conversationId,
      participations: { some: { userId: user.id, removedAt: null } },
    },
    select: {
      ghostSeconds: true,
      isGroup: true,
      participations: {
        where: { removedAt: null },
        select: { userId: true, lastReadAt: true, lastDeliveredAt: true },
      },
    },
  });
  if (!conversation) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const ghostSeconds = conversation.ghostSeconds ?? null;

  const peer = conversation.isGroup
    ? undefined
    : conversation.participations.find((p) => p.userId !== user.id);

  /* Idempotent replay. The outbox retries a send whose outcome it never
     learned — a TIMEOUT does not say whether this insert committed — so a
     retry carries the same clientKey and must return the ORIGINAL message
     rather than creating a second one.

     Checked after the membership lookup above, so a non-member still gets the
     404 and cannot use a key as an oracle. */
  const clientKey = parsed.clientKey ?? null;
  const replayMessage = async () => {
    if (!clientKey) return null;
    const existing = await db.message.findUnique({
      where: { clientKey },
      include: { author: true, reactions: { select: { emoji: true, userId: true } } },
    });
    return existing ?? null;
  };
  if (clientKey) {
    const existing = await replayMessage();
    if (existing) {
      /* A key is guessable, so never replay across a conversation or an
         author: that would hand back a message the caller should not see. */
      if (existing.conversationId !== conversationId || existing.authorId !== user.id) {
        return NextResponse.json({ ok: false, error: "client_key_conflict" }, { status: 409 });
      }
      return NextResponse.json({
        ok: true,
        message: mapMessage(
          existing,
          user.id,
          peer?.lastReadAt ?? null,
          peer?.lastDeliveredAt ?? null
        ),
        ghostSeconds,
        replayed: true,
      });
    }
  }

  let created;
  try {
    [created] = await db.$transaction([
      db.message.create({
        data: {
          conversationId,
          authorId: user.id,
          kind: parsed.kind,
          body: parsed.body,
          ...(clientKey ? { clientKey } : {}),
          ...(ghostSeconds ? { expiresAt: new Date(Date.now() + ghostSeconds * 1000) } : {}),
        },
        include: { author: true, reactions: { select: { emoji: true, userId: true } } },
      }),
      db.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
        select: { id: true },
      }),
    ]);
  } catch (error) {
    /* Two attempts raced past the check above and the loser hit the unique
       index. That is the expected outcome of a retry, not an error: re-read
       and replay. The transaction rolled back, so updatedAt was not bumped
       twice either. */
    if (!isClientKeyCollision(error)) throw error;
    const existing = await replayMessage();
    if (!existing || existing.conversationId !== conversationId || existing.authorId !== user.id) {
      return NextResponse.json({ ok: false, error: "client_key_conflict" }, { status: 409 });
    }
    return NextResponse.json({
      ok: true,
      message: mapMessage(existing, user.id, peer?.lastReadAt ?? null, peer?.lastDeliveredAt ?? null),
      ghostSeconds,
      replayed: true,
    });
  }

  /* OS notification for the recipients (round 23) — this is what was missing
     entirely: the push transport, the VAPID keys, the SW push listener and
     the subscribe UI all existed, but nothing on the message path ever called
     into them, so a new message produced no notification at all.

     Scheduled with `after`, so the send returns first: the push service is a
     third-party round-trip and the sender must not wait on it. A bare
     floating promise would not do — the handler's work can be cut off the
     moment it returns, whereas `after` extends the invocation. The callback
     cannot reject (notifyNewMessage absorbs its own failures).

     Every OTHER participant is notified: the one peer of a DM, everyone else
     in a group. The sender is never notified of their own message. */
  const recipients = conversation.participations.filter((p) => p.userId !== user.id);
  if (recipients.length > 0) {
    after(async () => {
      await Promise.all(
        recipients.map((p) => notifyNewMessage({ userId: p.userId, conversationId }))
      );
    });
  }

  return NextResponse.json({
    ok: true,
    message: mapMessage(created, user.id, peer?.lastReadAt ?? null, peer?.lastDeliveredAt ?? null),
    ghostSeconds,
  });
}

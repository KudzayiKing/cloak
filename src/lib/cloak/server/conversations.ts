import { db } from "@/lib/db";
import { roleOf, type GroupRole } from "./groups";

/*
 * Server-side conversation mapping. Bridges Prisma rows to the client store
 * contract (src/lib/cloak/types.ts):
 *   - Message.authorId is "me" for the viewer's own messages, another
 *     member's user id otherwise, and "system"/"cloak" for service notices.
 *   - Outgoing tick states derive from per-participant delivery/read
 *     markers in 1:1 chats; group messages stay honestly at "sent" until
 *     per-group read receipts ship.
 *   - Groups carry memberCount + the viewer's role; new-member history
 *     policy (historyFrom) hides pre-join messages from re-added members.
 * Message bodies are plaintext in this v1 build; the E2EE migration swaps
 * `body` for ciphertext without changing these shapes.
 */

export const MESSAGE_HISTORY_CAP = 200;

/* Ghost chat timers the client may set (seconds). 0 = off. */
export const GHOST_SECONDS_ALLOWED = [0, 30, 300, 3600, 86400, 604800] as const;

/** Delete messages whose ghost timer has run out. Called on access —
 *  cheap indexed deleteMany, no-op unless something actually expired. */
export async function purgeExpiredMessages() {
  await db.message.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

export interface ServerMessagePayload {
  id: string;
  conversationId: string;
  authorId: string;
  kind: string;
  body: string;
  createdAt: number; // epoch ms
  status?: "sent" | "delivered" | "read";
  authorName?: string;
  /** Ghost chats: epoch ms when the server will purge this message. */
  expiresAt?: number | null;
  reactions?: { emoji: string; count: number; mine?: boolean }[];
}

export interface ServerConversationPayload {
  id: string;
  contactId: string;
  isGroup: boolean;
  groupName?: string;
  groupDescription?: string;
  memberCount?: number;
  myRole?: GroupRole;
  /** Circle association (circles spec §53): set when this group belongs to
   *  a Cloak Circle. The circle surface + group header show it. */
  circleId?: string;
  circleName?: string;
  unreadCount: number;
  /** Ghost chat TTL in seconds; null = ghost mode off. */
  ghostSeconds: number | null;
  /** The group's OWN AI permission (spec §64) — server truth now, not a
   *  client-local toggle. */
  aiAccess: "allowed" | "blocked";
  /** EFFECTIVE AI access (spec §39 precedence): strictest of the group
   *  setting and the owning Circle's policy. "limited" = current request
   *  only (circle current_request). The client gates @Cloak on this. */
  aiEffective: "allowed" | "limited" | "blocked";
  /** Present when a Circle clamps this group — the UI shows why. */
  aiCircleDefault?: "disabled" | "current_request" | "allowed";
  persistentMemory: boolean;
  /** E2EE: current conversation-key version (0 = not provisioned). */
  keyVersion: number;
  /** Group history-sharing policy — drives client key handling on adds. */
  historyPolicy?: "none" | "all";
  messages: ServerMessagePayload[];
}

export interface ServerContactPayload {
  id: string;
  name: string;
  cloakId: string;
  avatarInitials: string;
  verification: "verified" | "unverified" | "pending";
  about?: string;
  /** E2EE identity public key (base64 raw); null until the user's client
   *  has provisioned keys. Wrapping conversation keys needs this. */
  identityPublicKey?: string | null;
}

type ParticipationRow = {
  userId: string;
  role: string;
  lastReadAt: Date | null;
  lastDeliveredAt: Date | null;
  historyFrom: Date | null;
  removedAt: Date | null;
};

type MessageRow = {
  id: string;
  conversationId: string;
  authorId: string | null;
  kind: string;
  body: string;
  createdAt: Date;
  expiresAt?: Date | null;
  author?: { displayName: string } | null;
  reactions?: { emoji: string; userId: string }[];
};

type ConvRow = {
  id: string;
  isGroup: boolean;
  title: string | null;
  description?: string | null;
  historyPolicy?: string;
  ghostSeconds?: number | null;
  keyVersion?: number;
  aiAccess?: string;
  circleId?: string | null;
  circle?: { id: string; name: string; aiDefault?: string } | null;
  participations: ParticipationRow[];
  messages?: MessageRow[];
};

export function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]!.toUpperCase()).join("");
}

export function mapMessage(
  m: MessageRow,
  viewerId: string,
  peerLastReadAt: Date | null,
  peerLastDeliveredAt: Date | null
): ServerMessagePayload {
  const mine = m.authorId === viewerId;
  const createdAtMs = m.createdAt.getTime();
  let status: ServerMessagePayload["status"] | undefined;
  if (mine) {
    if (peerLastReadAt && peerLastReadAt.getTime() >= createdAtMs) status = "read";
    else if (peerLastDeliveredAt && peerLastDeliveredAt.getTime() >= createdAtMs) status = "delivered";
    else status = "sent";
  }
  const reactionCounts = new Map<string, { emoji: string; count: number; mine?: boolean }>();
  for (const reaction of m.reactions ?? []) {
    const summary = reactionCounts.get(reaction.emoji) ?? {
      emoji: reaction.emoji,
      count: 0,
      mine: false,
    };
    summary.count += 1;
    if (reaction.userId === viewerId) summary.mine = true;
    reactionCounts.set(reaction.emoji, summary);
  }
  return {
    id: m.id,
    conversationId: m.conversationId,
    authorId: mine ? "me" : (m.authorId ?? "system"),
    kind: m.kind,
    body: m.body,
    createdAt: createdAtMs,
    status,
    authorName: m.author?.displayName ?? undefined,
    expiresAt: m.expiresAt ? m.expiresAt.getTime() : null,
    reactions: [...reactionCounts.values()].sort((a, b) => b.count - a.count),
  };
}

export function mapConversation(
  conv: ConvRow,
  viewerId: string,
  options: { includeMessages?: boolean; messageCap?: number; unreadCount?: number } = {}
): ServerConversationPayload {
  const mine = conv.participations.find((p) => p.userId === viewerId);
  const peer = conv.isGroup ? undefined : conv.participations.find((p) => p.userId !== viewerId);
  const active = conv.participations.filter((p) => !p.removedAt);
  const contactId = peer?.userId ?? conv.id;

  /* Effective AI access (spec §39 precedence — most restrictive wins):
     strictest of the group's own setting and the Circle's policy. A group
     can never weaken a Circle restriction; "limited" = current request
     only. */
  const groupAi: "allowed" | "blocked" = conv.isGroup && conv.aiAccess === "blocked" ? "blocked" : "allowed";
  const circleDefault =
    conv.circle?.aiDefault === "disabled" || conv.circle?.aiDefault === "current_request" || conv.circle?.aiDefault === "allowed"
      ? conv.circle.aiDefault
      : undefined;
  let aiEffective: "allowed" | "limited" | "blocked" = groupAi;
  if (aiEffective === "allowed" && circleDefault === "disabled") aiEffective = "blocked";
  else if (aiEffective === "allowed" && circleDefault === "current_request") aiEffective = "limited";

  const lastReadAt = mine?.lastReadAt ?? null;
  const historyFrom = mine?.historyFrom ?? null;

  const visible = (m: MessageRow) =>
    (!historyFrom || m.createdAt.getTime() >= historyFrom.getTime());

  const unreadCount =
    options.unreadCount ??
    (options.includeMessages
      ? 0
      : (conv.messages ?? []).filter(
          (m) =>
            visible(m) &&
            m.authorId !== viewerId &&
            m.authorId !== null &&
            (!lastReadAt || m.createdAt.getTime() > lastReadAt.getTime())
        ).length);

  let messages: ServerMessagePayload[] = [];
  if (options.includeMessages && conv.messages) {
    const cap = options.messageCap ?? MESSAGE_HISTORY_CAP;
    const sliced = [...conv.messages]
      .filter(visible)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-cap);
    messages = sliced.map((m) =>
      mapMessage(m, viewerId, peer?.lastReadAt ?? null, peer?.lastDeliveredAt ?? null)
    );
  } else if (conv.messages && conv.messages.length > 0) {
    /* List view: hydrate only the newest message so the sidebar can sort
       and render the preview without shipping full history. */
    const visibleMessages = [...conv.messages]
      .filter(visible)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const last = visibleMessages[visibleMessages.length - 1];
    if (last) {
      messages = [mapMessage(last, viewerId, peer?.lastReadAt ?? null, peer?.lastDeliveredAt ?? null)];
    }
  }

  return {
    id: conv.id,
    contactId,
    isGroup: conv.isGroup,
    groupName: conv.title ?? undefined,
    groupDescription: conv.description ?? undefined,
    memberCount: conv.isGroup ? active.length : undefined,
    myRole: conv.isGroup ? roleOf(mine?.role) : undefined,
    circleId: conv.circleId ?? undefined,
    circleName: conv.circle?.name,
    unreadCount,
    ghostSeconds: conv.ghostSeconds ?? null,
    aiAccess: groupAi,
    aiEffective,
    ...(circleDefault ? { aiCircleDefault: circleDefault } : {}),
    persistentMemory: true,
    keyVersion: conv.keyVersion ?? 0,
    historyPolicy: conv.isGroup ? ((conv.historyPolicy as "none" | "all") ?? "none") : undefined,
    messages,
  };
}

export async function loadConversationsForUser(userId: string) {
  const now = new Date();
  const convs = await db.conversation.findMany({
    where: { participations: { some: { userId, removedAt: null } } },
    include: {
      participations: true,
      circle: { select: { id: true, name: true, aiDefault: true } },
      messages: {
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        orderBy: { createdAt: "desc" as const },
        take: 1,
        include: { author: true, reactions: { select: { emoji: true, userId: true } } },
      },
    },
    orderBy: { updatedAt: "desc" as const },
  });

  /* People you share a conversation with -> contacts list. Removed group
     members stop being contacts through the group but keep their DMs. */
  const peerIds = [
    ...new Set(
      convs.flatMap((conv) =>
        conv.participations
          .filter((p) => p.userId !== userId && !p.removedAt)
          .map((p) => p.userId)
      )
    ),
  ];
  const peers = peerIds.length
    ? await db.user.findMany({ where: { id: { in: peerIds } } })
    : [];

  const contacts: ServerContactPayload[] = peers.map((u) => ({
    id: u.id,
    name: u.displayName,
    cloakId: `@${u.handle}`,
    avatarInitials: initialsOf(u.displayName),
    verification: "verified" as const,
    about: u.about ?? undefined,
    identityPublicKey: u.identityPublicKey,
  }));

  const conversations = convs.map((conv) => mapConversation(conv, userId));

  /* Order by last message time (mirrors the sidebar's own sort). */
  conversations.sort((a, b) => {
    const la = a.messages[0]?.createdAt ?? 0;
    const lb = b.messages[0]?.createdAt ?? 0;
    return lb - la;
  });

  return { contacts, conversations };
}

export async function loadConversationDetail(convId: string, viewerId: string) {
  await purgeExpiredMessages();
  const mine = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId: convId, userId: viewerId } },
  });
  if (!mine || mine.removedAt) return null;

  const conv = await db.conversation.findUnique({
    where: { id: convId },
    include: {
      participations: true,
      circle: { select: { id: true, name: true, aiDefault: true } },
      messages: {
        where: mine.historyFrom ? { createdAt: { gte: mine.historyFrom } } : undefined,
        orderBy: { createdAt: "desc" as const },
        take: MESSAGE_HISTORY_CAP,
        include: { author: true, reactions: { select: { emoji: true, userId: true } } },
      },
    },
  });
  if (!conv) return null;
  return mapConversation(conv, viewerId, { includeMessages: true });
}

/** Find-or-create a 1:1 conversation between two users.
 *  ghostSeconds: when provided, the conversation is put into (or switched
 *  to) ghost mode — this is how "New ghost chat" from the modal behaves
 *  for both fresh and existing DMs. */
export async function findOrCreateDm(
  userAId: string,
  userBId: string,
  ghostSeconds?: number
) {
  const candidates = await db.conversation.findMany({
    where: {
      isGroup: false,
      participations: { some: { userId: userAId } },
    },
    include: { participations: true },
  });
  const existing = candidates.find(
    (c) =>
      c.participations.length === 2 &&
      c.participations.some((p) => p.userId === userBId)
  );
  if (existing) {
    if (ghostSeconds !== undefined && (existing.ghostSeconds ?? null) !== ghostSeconds) {
      return db.conversation.update({
        where: { id: existing.id },
        data: { ghostSeconds: ghostSeconds > 0 ? ghostSeconds : null },
        include: { participations: true },
      });
    }
    return existing;
  }

  const created = await db.conversation.create({
    data: {
      isGroup: false,
      ...(ghostSeconds !== undefined && ghostSeconds > 0
        ? { ghostSeconds }
        : {}),
      participations: {
        create: [{ userId: userAId }, { userId: userBId }],
      },
    },
    include: { participations: true },
  });
  return created;
}

export async function isParticipant(convId: string, userId: string): Promise<boolean> {
  const p = await db.participation.findUnique({
    where: { conversationId_userId: { conversationId: convId, userId } },
  });
  return !!p && !p.removedAt;
}

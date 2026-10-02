"use client";

/*
 * Cached message history.
 *
 * WHY THIS IS WORTH MORE THAN IT LOOKS: the server keeps only the newest
 * `MESSAGE_HISTORY_CAP` (200) messages per conversation, and purges ghost rows
 * once their timer runs out. So this cache is not merely an offline
 * convenience — it is the ONLY way to retain history beyond that window.
 *
 * It is a READ-THROUGH CACHE, never a source of truth. The server still owns
 * ordering, receipts and membership; on reconnect the server's window is merged
 * over the cached rows (see the store's `replaceServerMessages`). Offline, a
 * receipt can therefore be stale — a message may read "sent" until it refreshes
 * — which is the honest trade for having history at all.
 *
 * ACCOUNT SCOPING. The database is keyed by ORIGIN, and one install may serve
 * several accounts (see the device registry), so every row carries the account
 * that wrote it and every read filters on it. Without this, account B would see
 * account A's conversation ids and timestamps. The vault key would stop B from
 * reading the bodies anyway, but metadata should not leak either.
 *
 * WHAT IS SEALED. Only the message BODY. The structural fields (id, author,
 * timestamps, kind, status, reactions) are stored in the clear because they are
 * needed for ordering, indexing and merging without decryption — and they are
 * exactly the fields the server already sees in the clear for every message.
 * So the cache exposes nothing the server does not, while the content itself
 * stays opaque at rest. See `local-vault.ts`.
 */

import type {
  AIProcessingDetails,
  DisappearingTimer,
  Message,
  MessageKind,
  MessageReactionSummary,
  MessageStatus,
} from "./types";
import {
  currentVaultUserId,
  openLocalText,
  parseSealedBox,
  sealLocalText,
  vaultScope,
  type SealedBox,
} from "@/lib/crypto/local-vault";
import {
  STORE_MESSAGES,
  deleteFromStore,
  getAllByIndex,
  withStore,
} from "./local-db";

export interface CachedMessageRow {
  id: string;
  /** Which account wrote this row. See ACCOUNT SCOPING above. */
  ownerUserId: string;
  conversationId: string;
  authorId: string;
  kind: string;
  createdAt: number;
  expiresAt?: number;
  status?: string;
  authorName?: string;
  replyToId?: string;
  viewed?: boolean;
  disappearsAfter?: DisappearingTimer;
  bodyLocked?: boolean;
  bodyLockedReason?: "missing" | "expired";
  reactions?: MessageReactionSummary[];
  ai?: AIProcessingDetails;
  bodySealed?: SealedBox;
  cachedAt: number;
}

/** A row after its body has been opened. */
export type CachedMessage = CachedMessageRow & { body: string };

/**
 * Signatures of what we already wrote, so the 2.5s poll does not rewrite every
 * message in the conversation on every tick. Receipts DO change, so the
 * signature covers the mutable fields rather than just the id.
 */
const writtenSignatures = new Map<string, string>();
const SIGNATURE_CAP = 8000;

function signatureOf(message: Message): string {
  return [
    message.status ?? "",
    message.expiresAt ?? "",
    message.bodyLocked ? "1" : "0",
    message.bodyLockedReason ?? "",
    message.viewed ? "1" : "0",
    message.body,
    message.reactions ? JSON.stringify(message.reactions) : "",
  ].join("\u0001");
}

/**
 * Write decrypted messages to the cache.
 *
 * Called with the output of the store's decryption pass, so the plaintext
 * exists only here and in memory. A message whose body cannot be sealed is
 * SKIPPED rather than stored body-less: an empty bubble offline would be a
 * worse lie than a missing row.
 */
export async function cacheMessages(messages: Message[]): Promise<void> {
  if (!messages.length) return;
  const ownerUserId = currentVaultUserId();
  /* No account published yet → we cannot attribute the rows, and an
     unattributed row would be visible to whichever account signs in next. */
  if (!ownerUserId) return;
  if (writtenSignatures.size > SIGNATURE_CAP) writtenSignatures.clear();

  for (const message of messages) {
    if (!message?.id || !message.conversationId) continue;

    const signature = signatureOf(message);
    if (writtenSignatures.get(message.id) === signature) continue;

    let bodySealed: SealedBox | undefined;
    if (!message.bodyLocked && message.body) {
      const sealed = await sealLocalText(message.body, vaultScope.message(message.id));
      /* No vault key (storage blocked) → leave this message uncached. It will
         be cached on a later pass once the vault is ready. */
      if (!sealed) continue;
      bodySealed = sealed;
    }

    const row: CachedMessageRow = {
      id: message.id,
      ownerUserId,
      conversationId: message.conversationId,
      authorId: message.authorId,
      kind: message.kind,
      createdAt: message.createdAt,
      cachedAt: Date.now(),
      ...(message.expiresAt !== undefined ? { expiresAt: message.expiresAt } : {}),
      ...(message.status ? { status: message.status } : {}),
      ...(message.authorName ? { authorName: message.authorName } : {}),
      ...(message.replyToId ? { replyToId: message.replyToId } : {}),
      ...(message.viewed ? { viewed: true } : {}),
      ...(message.disappearsAfter ? { disappearsAfter: message.disappearsAfter } : {}),
      ...(message.bodyLocked ? { bodyLocked: true } : {}),
      ...(message.bodyLockedReason ? { bodyLockedReason: message.bodyLockedReason } : {}),
      ...(message.reactions?.length ? { reactions: message.reactions } : {}),
      ...(message.ai ? { ai: message.ai } : {}),
      ...(bodySealed ? { bodySealed } : {}),
    };

    try {
      await withStore(STORE_MESSAGES, "readwrite", (store) => store.put(row));
      writtenSignatures.set(message.id, signature);
    } catch {
      /* A cache write failure must never break sending or rendering. */
    }
  }
}

/**
 * Read a conversation's cached history, newest `limit` rows, oldest first.
 *
 * Ghost rows whose timer has run out are dropped here AND deleted — that is the
 * local half of "honour disappearing messages", so a vanished message does not
 * reappear just because this device kept a copy.
 */
export async function loadCachedMessages(
  conversationId: string,
  limit = 400
): Promise<CachedMessage[]> {
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return [];

  let rows: CachedMessageRow[];
  try {
    rows = await getAllByIndex<CachedMessageRow>(
      STORE_MESSAGES,
      "conversationId",
      conversationId
    );
  } catch {
    return [];
  }
  rows = rows.filter((row) => row.ownerUserId === ownerUserId);
  if (!rows.length) return [];

  const now = Date.now();
  const expired: string[] = [];
  const live: CachedMessageRow[] = [];
  for (const row of rows) {
    if (row.expiresAt !== undefined && row.expiresAt !== null && row.expiresAt <= now) {
      expired.push(row.id);
      continue;
    }
    live.push(row);
  }
  for (const id of expired) {
    writtenSignatures.delete(id);
    await deleteFromStore(STORE_MESSAGES, id);
  }

  live.sort((a, b) => a.createdAt - b.createdAt);
  const window = limit > 0 && live.length > limit ? live.slice(live.length - limit) : live;

  const out: CachedMessage[] = [];
  for (const row of window) {
    let body = "";
    if (row.bodySealed) {
      const box = parseSealedBox(row.bodySealed);
      const opened = box ? await openLocalText(box, vaultScope.message(row.id)) : null;
      /* A body we cannot open is surfaced as locked rather than blank — the
         same honest state the live path uses when a key is missing. */
      if (opened === null) {
        out.push({
          ...row,
          body: "",
          bodyLocked: true,
          bodyLockedReason: row.bodyLockedReason ?? "missing",
        });
        continue;
      }
      body = opened;
    }
    out.push({ ...row, body });
  }
  return out;
}

/** Drop every cached row for one conversation. Used by teardown and by any
 *  future "delete conversation" action. */
export async function deleteCachedConversation(conversationId: string): Promise<void> {
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return;
  try {
    const rows = await getAllByIndex<CachedMessageRow>(
      STORE_MESSAGES,
      "conversationId",
      conversationId
    );
    for (const row of rows) {
      if (row.ownerUserId !== ownerUserId) continue;
      writtenSignatures.delete(row.id);
      await deleteFromStore(STORE_MESSAGES, row.id);
    }
  } catch {
    /* best effort */
  }
}

/** Drop one cached row. Ready for a message-delete feature; there is no
 *  delete path in the app yet, so nothing calls this today. */
export async function deleteCachedMessage(id: string): Promise<void> {
  writtenSignatures.delete(id);
  await deleteFromStore(STORE_MESSAGES, id);
}

/** Sweep every ghost row whose timer has run out. Cheap enough at boot:
 *  only ghost messages carry `expiresAt`, and rows are small. */
export async function purgeExpiredCachedMessages(): Promise<void> {
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return;
  try {
    const rows = await getAllByIndex<CachedMessageRow>(
      STORE_MESSAGES,
      "createdAt",
      IDBKeyRange.lowerBound(0)
    );
    const now = Date.now();
    for (const row of rows) {
      if (row.ownerUserId !== ownerUserId) continue;
      if (row.expiresAt !== undefined && row.expiresAt !== null && row.expiresAt <= now) {
        writtenSignatures.delete(row.id);
        await deleteFromStore(STORE_MESSAGES, row.id);
      }
    }
  } catch {
    /* best effort */
  }
}

export function forgetCachedSignatures(): void {
  writtenSignatures.clear();
}

/** Rebuild a renderable message from a cached row. Mirrors the store's
 *  `toClientMessage`, including the attachment-envelope hydration. */
export function cachedRowToMessage(
  row: CachedMessage,
  hydrate: (message: Message) => Message
): Message {
  return hydrate({
    id: row.id,
    conversationId: row.conversationId,
    authorId: row.authorId,
    kind: row.kind as MessageKind,
    body: row.body,
    createdAt: row.createdAt,
    status: row.status as MessageStatus | undefined,
    authorName: row.authorName,
    replyToId: row.replyToId,
    viewed: row.viewed,
    expiresAt: row.expiresAt,
    disappearsAfter: row.disappearsAfter ?? (row.expiresAt ? "custom" : undefined),
    reactions: row.reactions ?? [],
    ...(row.ai ? { ai: row.ai } : {}),
    ...(row.bodyLocked ? { bodyLocked: true } : {}),
    ...(row.bodyLockedReason ? { bodyLockedReason: row.bodyLockedReason } : {}),
  });
}

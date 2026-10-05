"use client";

/*
 * The outbox: messages the user has written that have NOT reached the server.
 *
 * WHY THIS EXISTS. Until now a send that could not complete was marked
 * `failed` and dropped — the words were gone, and the only way to recover them
 * was to retype them. Worse, the bubble already said "failed — tap to retry"
 * and no retry existed. This holds the message instead, so it survives a
 * reload, a dead connection and a closed tab, and sends itself when the
 * connection comes back.
 *
 * THE HARD PART IS NOT THE QUEUE, IT IS THE RETRY. A send that fails with a
 * clear error (404: not a member) is safe to discard. A send that TIMES OUT is
 * not: the request may well have committed on the server, and we simply never
 * saw the response. Retrying that blindly duplicates the message. The fix is an
 * idempotency key — `id` here is minted once and sent as `clientKey`, and the
 * server returns the ORIGINAL message for a repeat rather than creating a
 * second. So a retry is always safe, and this queue can retry as often as it
 * likes. See the messages route for the server half.
 *
 * SEALED UNDER THE VAULT KEY, NOT THE CONVERSATION KEY. This is the same
 * lesson the cache learned: a conversation key version is DESTROYED by forward
 * secrecy once it falls outside the window, and it may well be retired between
 * writing this message and getting a chance to send it. Encrypting at enqueue
 * time would therefore produce a body the recipient could never open — a
 * message that sends successfully and is permanently unreadable. So the
 * plaintext waits here under the device vault key (which never rotates) and is
 * encrypted with the conversation key only at FLUSH time.
 *
 * ACCOUNT SCOPING is the same rule as everywhere else in this database: the
 * database is keyed by origin while one install may serve several accounts, so
 * every row names its owner and every read filters on it.
 */

import type { MessageKind } from "./types";
import {
  currentVaultUserId,
  openLocalText,
  parseSealedBox,
  sealLocalText,
  vaultScope,
  type SealedBox,
} from "@/lib/crypto/local-vault";
import {
  STORE_OUTBOX,
  deleteFromStore,
  getAllByIndex,
  withStore,
} from "./local-db";

/**
 * A ceiling on pending sends, so a pathological loop (or a device left offline
 * for a very long time) cannot grow this without bound. Far above any plausible
 * real backlog: a row is a few hundred bytes of sealed text.
 */
export const OUTBOX_CAP = 500;

export interface OutboxRow {
  /** The idempotency key. Stable across every retry of this message. */
  id: string;
  ownerUserId: string;
  conversationId: string;
  kind: MessageKind;
  /** Sealed plaintext — or, for an attachment, the sealed metadata envelope. */
  bodySealed: SealedBox;
  /** Local attachment awaiting upload, if this carries media. */
  attachmentId?: string;
  /** When the user wrote it, so the optimistic bubble keeps its timestamp. */
  createdAt: number;
  /** FIFO order within the conversation. */
  queuedAt: number;
  attempts: number;
  nearbyDelivered?: boolean;
  nearbyDeliveredTo?: string[];
  nearbyRecipientCount?: number;
  lastAttemptAt?: number;
}

/** A row with its body opened. */
export interface OutboxEntry extends Omit<OutboxRow, "bodySealed"> {
  body: string;
}

export interface EnqueueInput {
  id: string;
  conversationId: string;
  kind: MessageKind;
  /** Plaintext, or the attachment metadata envelope as JSON. */
  plaintext: string;
  attachmentId?: string;
  createdAt?: number;
}

export interface EnqueueResult {
  ok: boolean;
  /**
   * Ids dropped to stay inside `OUTBOX_CAP`, oldest first. The caller must
   * surface these as failed rather than let them vanish silently.
   */
  evicted: string[];
}

/** Every row for the current account, oldest first. */
async function readRows(conversationId?: string): Promise<OutboxRow[]> {
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return [];
  let rows: OutboxRow[];
  try {
    rows = conversationId
      ? await getAllByIndex<OutboxRow>(STORE_OUTBOX, "conversationId", conversationId)
      : await getAllByIndex<OutboxRow>(STORE_OUTBOX, "queuedAt", IDBKeyRange.lowerBound(0));
  } catch {
    return [];
  }
  return rows
    .filter((row) => row.ownerUserId === ownerUserId)
    .sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id));
}

/**
 * Queue a message. Refuses when there is no vault key: an unsealed queue row
 * would be plaintext on disk, and a row sealed under a key we failed to persist
 * would be unopenable. The caller falls back to marking the send failed, which
 * is at least honest.
 */
export async function enqueueOutbox(input: EnqueueInput): Promise<EnqueueResult> {
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return { ok: false, evicted: [] };

  const sealed = await sealLocalText(input.plaintext, vaultScope.outbox(input.id));
  if (!sealed) return { ok: false, evicted: [] };

  const now = Date.now();
  const row: OutboxRow = {
    id: input.id,
    ownerUserId,
    conversationId: input.conversationId,
    kind: input.kind,
    bodySealed: sealed,
    createdAt: input.createdAt ?? now,
    queuedAt: now,
    attempts: 0,
    ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}),
  };

  try {
    await withStore(STORE_OUTBOX, "readwrite", (store) => store.put(row));
  } catch {
    return { ok: false, evicted: [] };
  }

  return { ok: true, evicted: await enforceOutboxCap() };
}

/** Trim to `OUTBOX_CAP`, oldest first, reporting what was dropped. */
async function enforceOutboxCap(): Promise<string[]> {
  const rows = await readRows();
  if (rows.length <= OUTBOX_CAP) return [];
  const doomed = rows.slice(0, rows.length - OUTBOX_CAP);
  for (const row of doomed) await deleteFromStore(STORE_OUTBOX, row.id);
  return doomed.map((row) => row.id);
}

/**
 * Read the queue with bodies opened.
 *
 * An entry whose body will not open is returned with an empty body rather than
 * being skipped, so the caller can mark that message failed and get it out of
 * the way instead of leaving a row that retries forever.
 */
export async function listOutbox(conversationId?: string): Promise<OutboxEntry[]> {
  const rows = await readRows(conversationId);
  const out: OutboxEntry[] = [];
  for (const row of rows) {
    const box = parseSealedBox(row.bodySealed);
    const body = box ? await openLocalText(box, vaultScope.outbox(row.id)) : null;
    const { bodySealed: _sealed, ...rest } = row;
    out.push({ ...rest, body: body ?? "" });
  }
  return out;
}

export async function countOutbox(): Promise<number> {
  return (await readRows()).length;
}

export async function deleteOutboxEntry(id: string): Promise<void> {
  await deleteFromStore(STORE_OUTBOX, id);
}

/**
 * Replace a row's sealed body in place.
 *
 * Used by the flush after a media upload succeeds, so the row records that the
 * payload is already on the server. Without this, a send whose BODY then timed
 * out would re-upload on retry, and the upload route answers 409 for an id it
 * already holds — while the crypto envelope needed to open it (a fresh random
 * IV) was thrown away with the first attempt, leaving a blob nobody can decrypt.
 */
export async function updateOutboxBody(id: string, plaintext: string): Promise<boolean> {
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return false;
  const sealed = await sealLocalText(plaintext, vaultScope.outbox(id));
  if (!sealed) return false;
  try {
    const row = await withStore<OutboxRow | undefined>(STORE_OUTBOX, "readonly", (store) =>
      store.get(id)
    );
    if (!row || row.ownerUserId !== ownerUserId) return false;
    await withStore(STORE_OUTBOX, "readwrite", (store) =>
      store.put({ ...row, bodySealed: sealed })
    );
    return true;
  } catch {
    return false;
  }
}

export async function markOutboxNearbyDelivered(id: string, details?: { deliveredTo?: string[]; recipientCount?: number }): Promise<void> {
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return;
  try {
    const row = await withStore<OutboxRow | undefined>(STORE_OUTBOX, "readonly", (store) => store.get(id));
    if (!row || row.ownerUserId !== ownerUserId) return;
    await withStore(STORE_OUTBOX, "readwrite", (store) => store.put({
      ...row,
      nearbyDelivered: true,
      ...(details?.deliveredTo ? { nearbyDeliveredTo: details.deliveredTo } : {}),
      ...(details?.recipientCount !== undefined ? { nearbyRecipientCount: details.recipientCount } : {}),
    }));
  } catch {
    /* Best effort; the message remains safely queued for server sync. */
  }
}

/** Record a failed attempt, so the UI can show "retrying" and backoff can be
 *  computed without a second write per tick. */
export async function bumpOutboxAttempt(id: string): Promise<void> {
  try {
    const row = await withStore<OutboxRow | undefined>(STORE_OUTBOX, "readonly", (store) =>
      store.get(id)
    );
    if (!row) return;
    await withStore(STORE_OUTBOX, "readwrite", (store) =>
      store.put({ ...row, attempts: (row.attempts ?? 0) + 1, lastAttemptAt: Date.now() })
    );
  } catch {
    /* best effort — a missed attempt count only affects backoff */
  }
}

/** Drop every pending send for the current account. Used by Dagger's panic
 *  wipe and by an explicit discard; never by "clear saved data". */
export async function discardOutbox(): Promise<void> {
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return;
  for (const row of await readRows()) {
    await deleteFromStore(STORE_OUTBOX, row.id);
  }
}

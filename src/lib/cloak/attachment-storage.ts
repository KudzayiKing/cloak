"use client";

/*
 * Device-local attachment storage — the LOCAL CACHE.
 *
 * Attachment bytes are written here so the device that created a note plays it
 * instantly and without a round trip, and so a RECEIVED note stays playable
 * offline and after the server's 30-day copy expires. The bytes are also sealed
 * and uploaded (see `attachment-remote.ts`) so the recipient can fetch them in
 * the first place.
 *
 * Everything written here is sealed under the DEVICE VAULT KEY, never under a
 * conversation key — conversation keys are versioned and, under forward
 * secrecy, deliberately destroyed, which would leave cached bytes permanently
 * unopenable. See `local-vault.ts`.
 */

import { parseBlobEnvelope, type BlobEnvelope } from "@/lib/crypto/e2ee";
import {
  currentVaultUserId,
  openLocal,
  parseSealedBox,
  sealLocal,
  vaultScope,
  type SealedBox,
} from "@/lib/crypto/local-vault";
import { ATTACHMENT_TTL_MS } from "./attachment-constants";
import {
  STORE_ATTACHMENTS,
  deleteFromStore,
  getAllByIndex,
  withStore,
} from "./local-db";

/**
 * Total bytes the attachment cache may hold before it starts evicting.
 *
 * Deliberately generous — the owner asked for "everything received" — but not
 * unbounded. Browsers evict an origin's storage ALL-OR-NOTHING once quota is
 * exceeded, so an unbounded cache would eventually take the cached MESSAGES
 * down with it, which is the worst possible outcome. Messages are ~9 KB each
 * and are never evicted; this budget covers the expensive part.
 */
export const ATTACHMENT_CACHE_BUDGET_BYTES = 1024 * 1024 * 1024; // 1 GiB

export interface LocalAttachmentRecord {
  id: string;
  /**
   * Which account wrote this row. The database is keyed by ORIGIN while one
   * install may serve several accounts, so without this account B could list
   * account A's file names and sizes. Absent on rows cached before this field
   * existed — those are matched by conversation alone, as they always were.
   */
  ownerUserId?: string;
  conversationId: string;
  name: string;
  mime: string;
  /** Plaintext size, as reported to the recipient. */
  size: number;
  createdAt: number;
  /** Vault-sealed bytes. Present on everything written since v2. */
  sealed?: SealedBox;
  /**
   * Legacy (v1) plaintext blob. Written only when the vault is unavailable —
   * a sender's own recording must still play even if sealing fails — and read
   * as a fallback for rows cached before this format existed.
   */
  blob?: Blob;
  /** Sealed byte count, used by the budget. */
  byteSize?: number;
  /** Last read; drives least-recently-used eviction. */
  lastUsedAt?: number;
}

export interface AttachmentEnvelope {
  type: "cloak.attachment";
  v: 1;
  attachmentId: string;
  name: string;
  mime: string;
  size: number;
  storedAt: number;
  /**
   * Voice notes only: how long the recording runs, in seconds. It rides the
   * envelope so the player can render the clock before any audio is fetched.
   * Absent for files and images.
   */
  durationSec?: number;
  /**
   * Crypto envelope for the uploaded copy — conversation key version, per-blob
   * key id, and IV. Present once the ciphertext reached the server; absent when
   * the upload failed or the note predates transport, in which case it is only
   * playable on the device that recorded it.
   *
   * It travels INSIDE the encrypted message body, so the server never sees it.
   */
  blob?: BlobEnvelope;
}

function recordSize(record: LocalAttachmentRecord): number {
  if (typeof record.byteSize === "number" && record.byteSize > 0) return record.byteSize;
  return typeof record.size === "number" ? record.size : 0;
}

/**
 * Keep the cache inside its budget.
 *
 * Eviction is least-recently-used, but biased: rows the server can still serve
 * are dropped FIRST, because any participant can simply download them again.
 * Only once nothing re-fetchable remains does this touch content whose server
 * copy has already expired — which is precisely the content the cache exists to
 * preserve, so it is the last thing to go.
 */
async function enforceAttachmentBudget(): Promise<void> {
  let rows: LocalAttachmentRecord[];
  try {
    rows = await getAllByIndex<LocalAttachmentRecord>(
      STORE_ATTACHMENTS,
      "createdAt",
      IDBKeyRange.lowerBound(0)
    );
  } catch {
    return;
  }
  if (!rows.length) return;

  let total = rows.reduce((sum, r) => sum + recordSize(r), 0);
  if (total <= ATTACHMENT_CACHE_BUDGET_BYTES) return;

  const now = Date.now();
  const ranked = rows
    .map((r) => ({
      record: r,
      used: r.lastUsedAt ?? r.createdAt ?? 0,
      refetchable: now - (r.createdAt ?? 0) < ATTACHMENT_TTL_MS,
    }))
    .sort((a, b) => a.used - b.used);

  for (const refetchablePass of [true, false]) {
    for (const candidate of ranked) {
      if (total <= ATTACHMENT_CACHE_BUDGET_BYTES) return;
      if (candidate.refetchable !== refetchablePass) continue;
      await deleteFromStore(STORE_ATTACHMENTS, candidate.record.id);
      total -= recordSize(candidate.record);
    }
  }
}

async function putRecord(record: LocalAttachmentRecord): Promise<void> {
  await withStore(STORE_ATTACHMENTS, "readwrite", (store) => store.put(record));
  void enforceAttachmentBudget();
}

export async function saveLocalAttachment(
  file: File,
  conversationId: string,
  options?: { durationSec?: number }
): Promise<{ record: LocalAttachmentRecord; envelope: AttachmentEnvelope }> {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `att-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const createdAt = Date.now();
  const name = file.name || "Attachment";
  const mime = file.type || "application/octet-stream";

  const bytes = await file.arrayBuffer().catch(() => null);
  const sealed = bytes ? await sealLocal(bytes, vaultScope.attachment(id)) : null;

  const ownerUserId = currentVaultUserId() ?? undefined;
  const record: LocalAttachmentRecord = {
    id,
    ...(ownerUserId ? { ownerUserId } : {}),
    conversationId,
    name,
    mime,
    size: file.size,
    createdAt,
    lastUsedAt: createdAt,
    ...(sealed
      ? { sealed, byteSize: sealed.ct.byteLength }
      : { blob: file, byteSize: file.size }),
  };
  await putRecord(record);

  const durationSec =
    typeof options?.durationSec === "number" && Number.isFinite(options.durationSec)
      ? Math.max(0, Math.round(options.durationSec))
      : undefined;
  return {
    record,
    envelope: {
      type: "cloak.attachment",
      v: 1,
      attachmentId: id,
      name,
      mime,
      size: record.size,
      storedAt: createdAt,
      ...(durationSec ? { durationSec } : {}),
    },
  };
}

/**
 * Cache a note or file this device RECEIVED.
 *
 * This is what makes a voice note playable offline and past the server's
 * 30-day expiry. The caller has already decrypted it with the conversation key
 * (which is about to become irrelevant) — the bytes are re-sealed here under
 * the vault key so the cached copy does not depend on that key surviving.
 */
export async function cacheReceivedAttachment(params: {
  id: string;
  conversationId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  bytes: ArrayBuffer;
}): Promise<void> {
  const { id, conversationId, name, mime, size, createdAt, bytes } = params;
  const ownerUserId = currentVaultUserId();
  if (!ownerUserId) return;
  const sealed = await sealLocal(bytes, vaultScope.attachment(id));
  if (!sealed) return;
  await putRecord({
    id,
    ownerUserId,
    conversationId,
    name,
    mime,
    size,
    createdAt,
    lastUsedAt: Date.now(),
    sealed,
    byteSize: sealed.ct.byteLength,
  });
}

/** The envelope as it should TRAVEL, once the upload has produced a crypto
 *  envelope. Called after `uploadAttachmentBlob` succeeds; on failure the
 *  caller passes nothing and the note travels as metadata only. */
export function withBlobEnvelope(
  envelope: AttachmentEnvelope,
  blob: BlobEnvelope | undefined
): AttachmentEnvelope {
  return blob ? { ...envelope, blob } : envelope;
}

/**
 * Read a local record.
 *
 * `conversationId` is REQUIRED, not optional. This store is keyed by origin
 * rather than by account, and one install may serve several accounts (see the
 * device registry), so an id-only lookup would let account B read account A's
 * media on a shared device. Naming the conversation is what makes that
 * impossible rather than merely unlikely.
 */
export async function getLocalAttachment(
  id: string,
  conversationId: string
): Promise<LocalAttachmentRecord | null> {
  if (!id) return null;
  let record: LocalAttachmentRecord | undefined;
  try {
    record = await withStore<LocalAttachmentRecord | undefined>(
      STORE_ATTACHMENTS,
      "readonly",
      (store) => store.get(id)
    );
  } catch {
    return null;
  }
  if (!record) return null;
  if (record.conversationId !== conversationId) return null;
  /* Rows written before account tagging existed have no owner and are matched
     by conversation alone, exactly as they always were. Newer rows must belong
     to the account currently signed in. */
  const ownerUserId = currentVaultUserId();
  if (record.ownerUserId !== undefined && record.ownerUserId !== ownerUserId) return null;
  return record;
}

/** Decode a stored record into playable bytes, whichever format it uses. */
export async function openLocalAttachment(
  record: LocalAttachmentRecord
): Promise<Blob | null> {
  if (record.sealed) {
    const box = parseSealedBox(record.sealed);
    if (!box) return null;
    const plain = await openLocal(box, vaultScope.attachment(record.id));
    if (!plain) return null;
    return new Blob([plain], { type: record.mime || "application/octet-stream" });
  }
  if (record.blob) return record.blob;
  return null;
}

/** Record a read so eviction can tell hot from cold. Fire-and-forget. */
export function touchLocalAttachment(id: string): void {
  void (async () => {
    try {
      const record = await withStore<LocalAttachmentRecord | undefined>(
        STORE_ATTACHMENTS,
        "readonly",
        (store) => store.get(id)
      );
      if (!record) return;
      record.lastUsedAt = Date.now();
      await withStore(STORE_ATTACHMENTS, "readwrite", (store) => store.put(record));
    } catch {
      /* best effort */
    }
  })();
}

export function parseAttachmentEnvelope(body: string): AttachmentEnvelope | null {
  try {
    const parsed = JSON.parse(body) as Partial<AttachmentEnvelope>;
    if (
      parsed.type !== "cloak.attachment" ||
      parsed.v !== 1 ||
      typeof parsed.attachmentId !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.mime !== "string" ||
      typeof parsed.size !== "number"
    ) {
      return null;
    }
    const blob = parseBlobEnvelope(parsed.blob);
    return {
      type: "cloak.attachment",
      v: 1,
      attachmentId: parsed.attachmentId,
      name: parsed.name,
      mime: parsed.mime,
      size: parsed.size,
      storedAt: typeof parsed.storedAt === "number" ? parsed.storedAt : Date.now(),
      ...(typeof parsed.durationSec === "number" && Number.isFinite(parsed.durationSec)
        ? { durationSec: Math.max(0, Math.round(parsed.durationSec)) }
        : {}),
      /* A malformed crypto envelope is dropped rather than half-honoured: the
         note then reads as "not transferred" instead of failing to decrypt. */
      ...(blob ? { blob } : {}),
    };
  } catch {
    return null;
  }
}

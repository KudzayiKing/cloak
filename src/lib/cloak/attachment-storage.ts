"use client";

/*
 * Device-local attachment storage.
 *
 * This is now the LOCAL CACHE, not the whole story. Attachment bytes are still
 * written here first, so the device that created a note plays it instantly and
 * without a round trip — but the bytes are also sealed and uploaded (see
 * `attachment-remote.ts`) so the recipient can actually hear them. The envelope
 * therefore carries the crypto envelope needed to open the uploaded copy.
 *
 * Keeping the local write is what makes the sender's own playback instant and
 * keeps working offline; it is no longer the only copy that exists.
 */

import { parseBlobEnvelope, type BlobEnvelope } from "@/lib/crypto/e2ee";

const DB_NAME = "cloak-attachments";
const DB_VERSION = 1;
const STORE = "attachments";

export interface LocalAttachmentRecord {
  id: string;
  conversationId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  blob: Blob;
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

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("conversationId", "conversationId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("attachment_db_open_failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("attachment_db_request_failed"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("attachment_db_transaction_failed"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("attachment_db_transaction_aborted"));
    };
  });
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
  const record: LocalAttachmentRecord = {
    id,
    conversationId,
    name: file.name || "Attachment",
    mime: file.type || "application/octet-stream",
    size: file.size,
    createdAt,
    blob: file,
  };
  await withStore("readwrite", (store) => store.put(record));
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
      name: record.name,
      mime: record.mime,
      size: record.size,
      storedAt: createdAt,
      ...(durationSec ? { durationSec } : {}),
    },
  };
}

/**
 * The envelope as it should TRAVEL, once the upload has produced a crypto
 * envelope. Called after `uploadAttachmentBlob` succeeds; on failure the caller
 * passes nothing and the note travels as metadata only.
 */
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
  const record = await withStore<LocalAttachmentRecord | undefined>("readonly", (store) =>
    store.get(id)
  );
  if (!record) return null;
  if (record.conversationId !== conversationId) return null;
  return record;
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

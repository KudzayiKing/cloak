"use client";

/*
 * Device-local attachment storage.
 *
 * Attachment bytes stay in the browser's origin storage (IndexedDB). Chat
 * transport sends only encrypted metadata, keeping file contents off Cloak's
 * API/database path. Dagger already clears IndexedDB as part of local wipe.
 */

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
  conversationId: string
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
    },
  };
}

export async function getLocalAttachment(id: string): Promise<LocalAttachmentRecord | null> {
  if (!id) return null;
  const record = await withStore<LocalAttachmentRecord | undefined>("readonly", (store) =>
    store.get(id)
  );
  return record ?? null;
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
    return {
      type: "cloak.attachment",
      v: 1,
      attachmentId: parsed.attachmentId,
      name: parsed.name,
      mime: parsed.mime,
      size: parsed.size,
      storedAt: typeof parsed.storedAt === "number" ? parsed.storedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

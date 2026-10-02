"use client";

/*
 * The one local cache database.
 *
 * The NAME is historical: this began as attachment storage only
 * (`cloak-attachments`) and now holds cached messages as well. It is
 * deliberately NOT renamed. The store name is invisible to users, and renaming
 * it would orphan every note already cached on existing devices — silently
 * breaking playback of anything recorded before the change. What actually
 * matters is the `cloak-` prefix, because that is what makes Dagger's
 * `clearIndexedDB()` cover this database during a panic wipe.
 *
 * Everything here is a CACHE — except the outbox. The server remains the source
 * of truth for ordering, receipts and membership; nothing in this layer is
 * authoritative. The one exception is `outbox`, which holds messages the user
 * wrote that have not reached the server yet: those exist nowhere else.
 */

export const DB_NAME = "cloak-attachments";
export const DB_VERSION = 3;
export const STORE_ATTACHMENTS = "attachments";
export const STORE_MESSAGES = "messages";
export const STORE_CONVERSATIONS = "conversations";
/**
 * Pending outgoing messages. NOT a cache — see `clearLocalCache` for why it is
 * deliberately excluded from the "clear saved data" action.
 */
export const STORE_OUTBOX = "outbox";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      /* v1 → v2 adds `messages`. Existing attachment rows are left untouched so
         previously cached notes keep working; they simply lack the newer
         bookkeeping fields, which every reader treats as optional. */
      if (!db.objectStoreNames.contains(STORE_ATTACHMENTS)) {
        const store = db.createObjectStore(STORE_ATTACHMENTS, { keyPath: "id" });
        store.createIndex("conversationId", "conversationId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const store = db.createObjectStore(STORE_MESSAGES, { keyPath: "id" });
        store.createIndex("conversationId", "conversationId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CONVERSATIONS)) {
        const store = db.createObjectStore(STORE_CONVERSATIONS, { keyPath: "id" });
        store.createIndex("cachedAt", "cachedAt", { unique: false });
      }
      /* v2 → v3 adds `outbox`. Existing caches are untouched. */
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const store = db.createObjectStore(STORE_OUTBOX, { keyPath: "id" });
        /* queuedAt is the FIFO order WITHIN a conversation; conversationId
           groups them. Neither is unique. */
        store.createIndex("queuedAt", "queuedAt", { unique: false });
        store.createIndex("conversationId", "conversationId", { unique: false });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      /* A held connection blocks a version upgrade in another tab. Release it
         so a future deploy can migrate instead of hanging on `blocked`. */
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("local_db_open_failed"));
    req.onblocked = () => reject(new Error("local_db_blocked"));
  });

  /* Never memoise a failure — the next call should be free to retry. */
  promise.catch(() => {
    if (dbPromise === promise) dbPromise = null;
  });
  dbPromise = promise;
  return promise;
}

export async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = run(tx.objectStore(storeName));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("local_db_request_failed"));
    tx.onerror = () => reject(tx.error ?? new Error("local_db_transaction_failed"));
    tx.onabort = () => reject(tx.error ?? new Error("local_db_transaction_aborted"));
  });
}

/** Read every row of an index key. Used for "all cached messages in this
 *  conversation", which is the only bulk read the cache needs. */
export async function getAllByIndex<T>(
  storeName: string,
  indexName: string,
  key: IDBValidKey | IDBKeyRange
): Promise<T[]> {
  const db = await openDb();
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).index(indexName).getAll(key);
    req.onsuccess = () => resolve((req.result ?? []) as T[]);
    req.onerror = () => reject(req.error ?? new Error("local_db_getall_failed"));
  });
}

export async function countStore(storeName: string): Promise<number> {
  try {
    return await withStore<number>(storeName, "readonly", (store) => store.count());
  } catch {
    return 0;
  }
}

/** Every row in a store. Used for the conversation list, which is small. */
export async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  try {
    return await withStore<T[]>(storeName, "readonly", (store) => store.getAll());
  } catch {
    return [];
  }
}

export async function deleteFromStore(storeName: string, key: IDBValidKey): Promise<void> {
  try {
    await withStore(storeName, "readwrite", (store) => store.delete(key));
  } catch {
    /* A failed cache eviction is not worth surfacing. */
  }
}

export async function clearStore(storeName: string): Promise<void> {
  await withStore(storeName, "readwrite", (store) => store.clear());
}

/** The user-facing "clear local data" action. Keys are untouched: this drops
 *  cached content, not the ability to decrypt anything.
 *
 *  The OUTBOX is deliberately excluded. Everything else in this database is a
 *  copy of something the server (or the sender) still has, so dropping it costs
 *  at most a re-download. An outbox row is a message the user WROTE and has not
 *  managed to send yet — there is no other copy anywhere, and clearing it would
 *  silently destroy their words. Panic wipe (Dagger) still takes it, because
 *  that is an explicit "leave nothing behind" action. */
export async function clearLocalCache(): Promise<void> {
  await Promise.all([
    clearStore(STORE_MESSAGES),
    clearStore(STORE_ATTACHMENTS),
    clearStore(STORE_CONVERSATIONS),
  ]);
}

/** Drop every pending send. Only Dagger and an explicit discard should call
 *  this — see `clearLocalCache`. */
export async function clearOutbox(): Promise<void> {
  await clearStore(STORE_OUTBOX);
}

/**
 * Drop ONE account's rows from the cache (account deletion).
 *
 * `clearLocalCache` / `clearOutbox` are whole-store operations, which is
 * correct for "clear saved data" and for Dagger. Account deletion is not: one
 * install may serve several Cloak IDs, so erasing one account must leave the
 * other account's cached history alone. Every row carries `ownerUserId`, so
 * the purge is a filtered scan — there is no index on it, but these stores are
 * small and this runs once.
 *
 * The outbox is INCLUDED here, unlike in `clearLocalCache`. Its exclusion
 * exists to stop a casual "free up space" tap from destroying unsent words;
 * deleting the account is the one case where the words can never be sent, so
 * keeping them would only leave the account's content on the device.
 */
export async function clearLocalCacheForOwner(ownerUserId: string): Promise<void> {
  await Promise.all(
    [STORE_MESSAGES, STORE_ATTACHMENTS, STORE_CONVERSATIONS, STORE_OUTBOX].map(async (storeName) => {
      const rows = await getAllFromStore<{ id: IDBValidKey; ownerUserId?: string }>(storeName);
      const keys = rows
        .filter((row) => row && row.ownerUserId === ownerUserId)
        .map((row) => row.id);
      if (keys.length === 0) return;
      /* One readwrite transaction for the batch; `count()` is only a
         completion token, so the promise resolves after the deletes are
         committed. */
      await withStore(storeName, "readwrite", (store) => {
        for (const key of keys) store.delete(key);
        return store.count();
      });
    })
  );
}

/**
 * Ask the browser to make this origin's storage persistent.
 *
 * Without it the cache is "best effort": a browser under pressure may evict the
 * whole origin, which would take the messages and the attachments together.
 * Best-effort — Safari in particular grants this only for installed apps.
 */
export async function ensurePersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Approximate bytes used by the cache, for the storage panel. */
export async function localCacheEstimate(): Promise<{ usage?: number; quota?: number }> {
  try {
    const est = await navigator.storage?.estimate?.();
    return { usage: est?.usage, quota: est?.quota };
  } catch {
    return {};
  }
}

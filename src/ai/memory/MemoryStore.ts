/*
 * MemoryStore (spec §6 Layer 1).
 *
 * Persistent local knowledge: facts, events, people, summaries the user
 * (or explicit product moments) stored deliberately. Persistence is
 * browser-local; sensitive records are designed to be encrypted at rest
 * once the WebCrypto layer is wired — the interface already reserves it.
 *
 * Current implementation: localStorage-backed (browser-local database).
 * The storage boundary is this class only — swapping to IndexedDB or an
 * encrypted store changes nothing above it.
 */

import type { MemoryRecord } from "./types";

const STORAGE_KEY = "cloak-memory-store-v1";

export class MemoryStore {
  private cache: MemoryRecord[] | null = null;

  private load(): MemoryRecord[] {
    if (this.cache) return this.cache;
    if (typeof window === "undefined") {
      this.cache = [];
      return this.cache;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      this.cache = raw ? (JSON.parse(raw) as MemoryRecord[]) : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }

  private save(records: MemoryRecord[]) {
    this.cache = records;
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch {
      // Storage quota errors must never break messaging.
    }
  }

  all(): MemoryRecord[] {
    return [...this.load()];
  }

  add(record: Omit<MemoryRecord, "id" | "createdAt"> & { id?: string }): MemoryRecord {
    const full: MemoryRecord = {
      ...record,
      id: record.id ?? `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    this.save([...this.load(), full]);
    return full;
  }

  remove(id: string) {
    this.save(this.load().filter((r) => r.id !== id));
  }

  clear() {
    this.save([]);
  }

  count(): number {
    return this.load().length;
  }
}

/** Shared singleton. */
export const memoryStore = new MemoryStore();

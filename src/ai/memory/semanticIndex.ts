/*
 * Semantic index (spec §6 Layer 2).
 *
 * Uses EmbeddingGemma locally when the artifact is configured. Until then,
 * hasSemantic() is false and retrieval falls back to the keyword path —
 * a graceful, honest degradation (spec §29: messaging works without local AI).
 */

import type { EmbeddingProvider } from "@/ai/providers/embedding/EmbeddingProvider";
import type { MemoryRecord } from "./types";

export interface SemanticEntry {
  record: MemoryRecord;
  vector?: Float32Array;
}

export class SemanticIndex {
  private entries: SemanticEntry[] = [];

  constructor(private provider?: EmbeddingProvider) {}

  setProvider(provider: EmbeddingProvider) {
    this.provider = provider;
  }

  async hasSemantic(): Promise<boolean> {
    return !!(this.provider && (await this.provider.isAvailable()));
  }

  async index(records: MemoryRecord[]): Promise<void> {
    this.entries = records.map((record) => ({ record }));
    if (!(await this.hasSemantic()) || !this.provider?.embedBatch) return;
    const vectors = await this.provider.embedBatch(
      records.map((r) => `${r.subject} ${r.fact}`)
    );
    this.entries = records.map((record, i) => ({
      record,
      vector: vectors[i],
    }));
  }

  async search(query: string, limit = 6): Promise<{ record: MemoryRecord; score: number }[]> {
    if (!(await this.hasSemantic()) || !this.provider) return [];
    const qv = await this.provider.embed(query);
    return this.entries
      .filter((e) => e.vector)
      .map((e) => ({ record: e.record, score: cosine(qv, e.vector!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

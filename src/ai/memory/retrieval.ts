/*
 * Retrieval pipeline (spec §6 Layer 2).
 *
 * Combines structured indexes, keyword search, subject match, and recency.
 * Semantic retrieval joins automatically when EmbeddingGemma is available.
 * Only the small retrieved context is handed to the reasoning model —
 * Gemma never searches the memory database itself (spec §6).
 */

import type { RetrievalQuery, RetrievedItem, MemoryRecord } from "./types";
import { keywordSearch } from "./keywordIndex";
import { memoryStore } from "./MemoryStore";
import type { SemanticIndex } from "./semanticIndex";

let semanticIndexRef: SemanticIndex | null = null;

/** Wired by the orchestrator at runtime; optional. */
export function setSemanticIndex(index: SemanticIndex) {
  semanticIndexRef = index;
}

function scopeFilter(
  records: MemoryRecord[],
  query: RetrievalQuery
): MemoryRecord[] {
  switch (query.scope) {
    case "none":
      return [];
    case "current-conversation":
      // In the standalone workspace there is no single current chat,
      // so the scope resolves to the permitted set.
      if (!query.currentConversationId) return records;
      return records.filter(
        (r) => !r.sourceConversationId || r.sourceConversationId === query.currentConversationId
      );
    case "selected-conversations":
    case "selected-contacts":
    case "all-permitted":
    default:
      return records;
  }
}

export async function retrieve(query: RetrievalQuery): Promise<RetrievedItem[]> {
  const all = memoryStore.all();
  const scoped = scopeFilter(all, query);
  if (scoped.length === 0) return [];

  const byId = new Map<string, RetrievedItem>();

  // Keyword path — always available.
  for (const m of keywordSearch(query.text, scoped, 10)) {
    byId.set(m.record.id, {
      record: m.record,
      score: m.score,
      matchedBy: ["keyword"],
    });
  }

  // Semantic path — when the local embedding model is available.
  const semantic = semanticIndexRef;
  if (semantic && (await semantic.hasSemantic())) {
    try {
      const sem = await semantic.search(query.text, 8);
      for (const s of sem) {
        if (!scoped.some((r) => r.id === s.record.id)) continue;
        const existing = byId.get(s.record.id);
        if (existing) {
          existing.score = Math.max(existing.score, s.score);
          existing.matchedBy.push("semantic");
        } else {
          byId.set(s.record.id, {
            record: s.record,
            score: s.score,
            matchedBy: ["semantic"],
          });
        }
      }
    } catch {
      // Semantic failure must not break deterministic retrieval.
    }
  }

  // Recency boost — fresher memories rank slightly higher.
  const now = Date.now();
  const results = [...byId.values()].map((r) => {
    const ageDays = (now - r.record.createdAt) / 86_400_000;
    const recency = Math.max(0, 0.15 - ageDays * 0.001);
    return { ...r, score: Math.min(1, r.score + recency), matchedBy: r.matchedBy.includes("recency") ? r.matchedBy : [...r.matchedBy, "recency" as const] };
  });

  const limit = query.limit ?? 4;
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

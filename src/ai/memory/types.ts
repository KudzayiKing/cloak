/*
 * Memory layer types (spec §6 Layer 1/2, §31).
 */

import type { MemoryScope } from "@/lib/cloak/types";

export interface MemoryRecord {
  id: string;
  /** Person or subject the fact is about. */
  subject: string;
  fact: string;
  sourceConversationId?: string;
  createdAt: number;
  tags: string[];
  /** Encrypted-at-rest once the crypto layer is wired (spec §35). */
  sensitive?: boolean;
}

export interface RetrievalQuery {
  text: string;
  scope: MemoryScope;
  currentConversationId?: string;
  /** Conversations the user explicitly selected for this session. */
  allowedConversationIds?: string[];
  limit?: number;
}

export interface RetrievedItem {
  record: MemoryRecord;
  score: number;
  matchedBy: ("keyword" | "semantic" | "recency" | "subject")[];
}

/*
 * Keyword index (spec §6 Layer 2) — deterministic, always available.
 * Tokenizes facts and ranks by term overlap with the query.
 */

import type { MemoryRecord } from "./types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for",
  "is", "was", "were", "are", "be", "been", "it", "this", "that",
  "with", "as", "by", "from", "you", "your", "i", "me", "my", "we",
  /* interrogatives & auxiliaries — they must not dilute retrieval */
  "what", "when", "where", "who", "whom", "whose", "why", "how", "which",
  "did", "do", "does", "done", "say", "said", "says", "tell", "told",
  "will", "would", "can", "could", "should", "shall", "may", "might",
  "have", "has", "had", "get", "got", "about", "there", "their", "them",
  "they", "he", "she", "his", "her", "him", "if", "so", "not", "no",
  "up", "out", "all", "any", "everything", "something", "anything",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9@.]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface KeywordMatch {
  record: MemoryRecord;
  score: number;
}

export function keywordSearch(
  query: string,
  records: MemoryRecord[],
  limit = 8
): KeywordMatch[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const results: KeywordMatch[] = [];
  for (const record of records) {
    const haystack = tokenize(
      `${record.subject} ${record.fact} ${record.tags.join(" ")}`
    );
    const set = new Set(haystack);
    let score = 0;
    for (const token of queryTokens) {
      if (set.has(token)) score += 1;
      else if (haystack.some((h) => h.startsWith(token) || token.startsWith(h)))
        score += 0.5;
    }
    if (score > 0) {
      results.push({ record, score: score / queryTokens.length });
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

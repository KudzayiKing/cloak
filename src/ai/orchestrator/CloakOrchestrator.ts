/*
 * CloakOrchestrator (spec §2, §6 Layer 4).
 *
 * Order of operations for every intelligence request:
 *   1. Retrieve scoped memories (keyword now, semantic when available).
 *   2. Decide the execution route — deterministic first, Cloaq AI only when
 *      synthesis is genuinely required.
 *   3. Execute and return an auditable result: route, retrieved items,
 *      provider, and where processing happened.
 *
 * Never invokes Cloaq AI merely because the user typed @Cloak (spec §6).
 * Never falls back to cloud silently (spec §7).
 */

import type { AIProcessingDetails, ExecutionRoute } from "@/lib/cloak/types";
import type { RetrievalQuery, RetrievedItem } from "@/ai/memory/types";
import { retrieve } from "@/ai/memory/retrieval";
import { memoryStore } from "@/ai/memory/MemoryStore";
import { LocalGemmaProvider, type LocalGemmaStatus } from "@/ai/providers/inference/LocalGemmaProvider";

export interface OrchestrationRequest {
  query: string;
  retrieval: Omit<RetrievalQuery, "text">;
  /** When false, local LLM routing degrades to an explicit unavailable state. */
  allowLocalLLM?: boolean;
}

export interface OrchestrationResult {
  answer: string;
  route: ExecutionRoute;
  /** Null when the request was answered without generation. */
  ai?: AIProcessingDetails;
  /** Set when local synthesis was needed but unavailable. */
  localUnavailableState?: LocalGemmaStatus;
}

/** Confidence above which retrieval alone answers the request. */
const DETERMINISTIC_THRESHOLD = 0.75;

export class CloakOrchestrator {
  private local = new LocalGemmaProvider();

  async run(request: OrchestrationRequest): Promise<OrchestrationResult> {
    const startedAt = Date.now();

    const retrieved = await retrieve({ ...request.retrieval, text: request.query });

    /* Route 1 — deterministic: a retrieved fact directly answers the ask. */
    const direct = this.deterministicAnswer(request.query, retrieved);
    if (direct) {
      return {
        answer: direct,
        route: "deterministic",
        ai: this.details("deterministic", retrieved, 0, startedAt),
      };
    }

    /* Route 2 — retrieval-only: useful context exists, synthesize from it. */
    const topScore = retrieved[0]?.score ?? 0;
    if (retrieved.length > 0 && topScore >= 0.45) {
      if (request.allowLocalLLM !== false) {
        const status = await this.local.status();
        if (status === "ready") {
          const result = await this.local.generate({
            prompt: request.query,
            context: retrieved.map((r) => r.record.fact),
          });
          return {
            answer: result.text,
            route: "local-llm",
            ai: this.details("local-llm", retrieved, retrieved.length, startedAt),
          };
        }
        return {
          answer: "",
          route: "local-llm",
          localUnavailableState: status,
          ai: this.details("local-llm", retrieved, retrieved.length, startedAt),
        };
      }
    }

    /* Route 3 — nothing conclusive locally. Cloud is NEVER used silently;
       the caller decides whether to surface an explicit consent surface. */
    return {
      answer: "",
      route: "cloud-fallback",
      ai: this.details("cloud-fallback", retrieved, retrieved.length, startedAt),
    };
  }

  /*
   * Deterministic answering: the retrieved fact is restated, not generated.
   * This is what keeps simple factual asks fast, private, and reliable.
   */
  private deterministicAnswer(
    query: string,
    retrieved: RetrievedItem[]
  ): string | null {
    if (retrieved.length === 0) return null;
    const top = retrieved[0];
    if (top.score < DETERMINISTIC_THRESHOLD) return null;

    const q = query.toLowerCase();

    // "what time / when" asks answered by a time-bearing fact.
    const timeAsk = /what time|when|which day|what day|what date/.test(q);
    const factHasTime =
      /\d{1,2}(:\d{2})?\s?(am|pm)|\b\d{1,2}\s?(am|pm)\b|monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(
        top.record.fact
      );
    if (timeAsk && factHasTime && top.score >= 0.6) {
      return top.record.fact;
    }

    // Who/where/what-is asks answered by a single strong fact.
    if (top.score >= 0.85) {
      return top.record.fact;
    }

    return null;
  }

  private details(
    route: ExecutionRoute,
    retrieved: RetrievedItem[],
    itemCount: number,
    startedAt: number
  ): AIProcessingDetails {
    void itemCount;
    return {
      provider:
        route === "cloud-fallback"
          ? "None (awaiting consent)"
          : route === "deterministic"
            ? "Cloaq AI"
            : "Cloaq AI",
      model:
        route === "deterministic"
          ? "Structured retrieval"
          : route === "cloud-fallback"
            ? "Not run"
            : "Cloaq AI",
      location: "This device",
      cloudUsed: false,
      memoryUploaded: false,
      retrievedItems: retrieved.length,
      retrieved: retrieved.map((r) => ({
        id: r.record.id,
        label: r.record.fact.length > 64 ? r.record.fact.slice(0, 64) + "…" : r.record.fact,
        source: "memory" as const,
      })),
      route,
    };
  }
}

/* Ensure demo memories exist so the orchestrator answers on first run. */
export function ensureSeededMemories(seeds: { subject: string; fact: string; sourceConversationId: string; createdAt: number; tags: string[] }[]) {
  if (memoryStore.count() === 0) {
    for (const s of seeds) {
      memoryStore.add(s);
    }
  }
}

export const cloakOrchestrator = new CloakOrchestrator();

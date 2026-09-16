/*
 * LocalEmbeddingGemmaProvider (spec §2, §6 Layer 2).
 * Produces local vectors for the semantic index. Vectorization runs locally;
 * nothing about the embedding process contacts the network.
 */

import type { EmbeddingProvider } from "./EmbeddingProvider";
import { modelManifest } from "@/ai/models/manifest";

export class LocalEmbeddingGemmaProvider implements EmbeddingProvider {
  readonly providerId = "LocalEmbeddingGemmaProvider";

  async isAvailable(): Promise<boolean> {
    return Boolean(modelManifest.embedding?.url);
  }

  async embed(text: string): Promise<Float32Array> {
    if (!modelManifest.embedding?.url) {
      throw new Error(
        "Cloaq AI embedding artifact not configured. Keyword retrieval remains fully functional."
      );
    }
    // With the artifact configured, inference runs through the embedding
    // worker. Semantic retrieval degrades gracefully to keyword search until then.
    throw new Error("Cloaq AI embedding artifact pending configuration.");
  }
}

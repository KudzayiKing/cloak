/*
 * Embedding provider abstraction (spec §4).
 * EmbeddingGemma is separate from Gemma (spec §10-D): it powers semantic
 * retrieval, never generation.
 */

export interface EmbeddingProvider {
  readonly providerId: string;
  isAvailable(): Promise<boolean>;
  initialize?(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch?(texts: string[]): Promise<Float32Array[]>;
}

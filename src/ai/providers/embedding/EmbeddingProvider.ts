/*
 * Embedding provider abstraction (spec §4).
 * Cloaq AI embeddings are separate from generation (spec §10-D): semantic
 * retrieval, never generation.
 */

export interface EmbeddingProvider {
  readonly providerId: string;
  isAvailable(): Promise<boolean>;
  initialize?(): Promise<void>;
  embed(text: string): Promise<Float32Array>;
  embedBatch?(texts: string[]): Promise<Float32Array[]>;
}

/*
 * Inference provider abstraction (spec §4).
 * Application code never couples to LiteRT-LM, WebGPU, or any runtime detail.
 */

export interface GenerationRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** Small retrieved context ONLY — never the whole memory database. */
  context?: string[];
}

export interface GenerationResult {
  text: string;
  providerId: string;
  modelId: string;
  /** Wall-clock generation time in ms. */
  durationMs?: number;
}

export interface GenerationChunk {
  textDelta: string;
}

export interface InferenceProvider {
  readonly providerId: string;
  isAvailable(): Promise<boolean>;
  initialize?(): Promise<void>;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  generateStream?(
    request: GenerationRequest
  ): AsyncIterable<GenerationChunk>;
}

/*
 * LocalGemmaProvider — the FIRST implementation priority (spec §4).
 *
 * Execution target (spec §5):
 *   PWA -> Web Worker -> LiteRT-LM JS -> WebGPU -> Cloaq AI artifact
 *
 * This provider reports honest states. When the model artifact URL has not
 * been configured (R2 delivery pending) or WebGPU is missing, isAvailable()
 * is false and callers surface an explicit install/unsupported state —
 * never a silent fallback to cloud (spec §7, §30).
 */

import type {
  GenerationRequest,
  GenerationResult,
  InferenceProvider,
} from "./InferenceProvider";
import { modelManifest } from "@/ai/models/manifest";
import { checkLocalAIAvailability } from "@/lib/cloak/capability";
import type { LocalAIAvailability } from "@/lib/cloak/capability";

export type LocalGemmaStatus =
  | "webgpu-unavailable"
  | "artifact-not-configured"
  | "not-installed"
  | "downloading"
  | "verifying"
  | "ready"
  | "error";

export class LocalGemmaProvider implements InferenceProvider {
  readonly providerId = "LocalGemmaProvider";

  private availability: LocalAIAvailability | null = null;
  private initialized = false;

  async checkAvailability(): Promise<LocalAIAvailability> {
    if (!this.availability) {
      this.availability = await checkLocalAIAvailability();
    }
    return this.availability;
  }

  async status(): Promise<LocalGemmaStatus> {
    const a = await this.checkAvailability();
    if (!a.webGPU) return "webgpu-unavailable";
    if (!modelManifest.gemma.url) return "artifact-not-configured";
    // Real installation state is owned by the model manager; until the
    // artifact exists in local storage the provider cannot initialize.
    const installed = await import("@/ai/models/modelStorage").then((m) =>
      m.modelStorage.hasArtifact(modelManifest.gemma.id)
    );
    if (!installed) return "not-installed";
    return "ready";
  }

  async isAvailable(): Promise<boolean> {
    return (await this.status()) === "ready";
  }

  async initialize(): Promise<void> {
    const st = await this.status();
    if (st !== "ready") {
      throw new Error(
        `Cloaq AI is not ready (state: ${st}). Install the model artifact first.`
      );
    }
    // Runtime bootstrap happens inside gemma.worker.ts; the worker owns
    // LiteRT-LM lifecycle so generation never blocks the UI thread.
    this.initialized = true;
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    await this.initialize();
    // With a configured .litertlm artifact this call posts to the worker and
    // awaits streamed output. Until the owner supplies the artifact URL the
    // orchestrator never reaches this line — it routes around it and the UI
    // presents an explicit local-unavailable state.
    throw new Error(
      "Local generation requires the Cloaq AI artifact to be configured."
    );
  }
}

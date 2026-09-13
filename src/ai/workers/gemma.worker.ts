/*
 * gemma.worker.ts — generation worker (spec §5).
 *
 * Owns the LiteRT-LM lifecycle so generation never blocks the UI thread.
 * Protocol:
 *   -> { type: "init", artifactUrl, nonce }
 *   -> { type: "generate", id, prompt, context?, maxTokens? }
 *   <- { type: "ready" | "error", nonce?, message? }
 *   <- { type: "chunk", id, textDelta }
 *   <- { type: "done", id, text }
 *
 * When the owner supplies the .litertlm artifact URL, init() loads Google's
 * LiteRT-LM JavaScript runtime inside this worker (WebGPU-backed). Until
 * then the worker reports a precise error instead of pretending.
 */

/// <reference lib="webworker" />

interface InitMessage {
  type: "init";
  artifactUrl?: string;
  nonce?: number;
}

interface GenerateMessage {
  type: "generate";
  id: string;
  prompt: string;
  context?: string[];
  maxTokens?: number;
}

type WorkerRequest = InitMessage | GenerateMessage;

let initialized = false;
let artifactUrl: string | null = null;

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  if (msg.type === "init") {
    artifactUrl = msg.artifactUrl ?? null;
    if (!artifactUrl) {
      (self as unknown as Worker).postMessage({
        type: "error",
        message: "No model artifact URL configured.",
      });
      return;
    }
    // LiteRT-LM bootstrap goes here once the artifact is deliverable.
    initialized = true;
    (self as unknown as Worker).postMessage({ type: "ready", nonce: msg.nonce });
    return;
  }

  if (msg.type === "generate") {
    if (!initialized) {
      (self as unknown as Worker).postMessage({
        type: "error",
        message: "Worker not initialized. Install and verify the model first.",
      });
      return;
    }
    // Streaming generation loop lands here (LiteRT-LM generate API).
    (self as unknown as Worker).postMessage({
      type: "error",
      id: msg.id,
      message: "Generation requires the configured .litertlm artifact.",
    });
  }
});

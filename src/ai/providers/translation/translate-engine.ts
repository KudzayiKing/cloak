"use client";

/*
 * TranslateGemma engine — real on-device translation (user request:
 * long-press a message -> Translate -> runs locally in the browser).
 *
 * Pipeline:
 *   1. WebGPU capability check (honest unsupported state — no silent
 *      fallback, spec §7).
 *   2. Model artifact: fetched once with streaming progress and cached in
 *      OPFS (origin-private file system) so later sessions skip the
 *      ~3.9 GB download. When OPFS is unavailable the engine falls back
 *      to letting MediaPipe fetch the URL directly (uncached).
 *   3. MediaPipe LLM Inference (@mediapipe/tasks-genai) loads the .task
 *      artifact with WebGPU and generates the translation; responses
 *      stream token-by-token into the chat bubble.
 *
 * The message text and the translation never leave the device — this is
 * the same privacy contract as the rest of the local AI stack (spec §4).
 */

import { modelManifest } from "@/ai/models/manifest";

const TASKS_GENAI_VERSION = "0.10.29";
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@${TASKS_GENAI_VERSION}/wasm`;
const OPFS_FILE_NAME = "translategemma-4b-it-int8-web.task";

export type TranslateEngineState =
  | "idle"
  | "unsupported"
  | "downloading"
  | "loading"
  | "ready"
  | "error";

export interface TranslateEngineStatus {
  state: TranslateEngineState;
  /** 0..1 while downloading. */
  progress?: number;
  receivedBytes?: number;
  totalBytes?: number;
  message: string;
}

type Listener = (status: TranslateEngineStatus) => void;

export interface TranslateRequest {
  text: string;
  sourceLanguageName: string;
  sourceLanguageCode: string;
  targetLanguageName: string;
  targetLanguageCode: string;
  onPartial?: (partialText: string) => void;
}

/**
 * TranslateGemma prompt — Google's documented "preferred prompt" for the
 * model (TranslateGemma technical report, Figure 3), wrapped in Gemma's
 * turn markers because MediaPipe applies no chat template itself.
 * Two blank lines separate the instruction from the text (as shipped).
 */
export function buildTranslatePrompt(req: TranslateRequest): string {
  const s = req.sourceLanguageName;
  const t = req.targetLanguageName;
  return [
    "<start_of_turn>user",
    `You are a professional ${s} (${req.sourceLanguageCode}) to ${t} (${req.targetLanguageCode}) translator. ` +
      `Your goal is to accurately convey the meaning and nuances of the original ${s} text while adhering to ` +
      `${t} grammar, vocabulary, and cultural sensitivities. Produce only the ${t} translation, without any ` +
      `additional explanations or commentary. Please translate the following ${s} text into ${t}:`,
    "",
    "",
    `${req.text}<end_of_turn>`,
    "<start_of_turn>model",
  ].join("\n");
}

function cleanTranslationOutput(raw: string): string {
  let out = raw ?? "";
  out = out.replace(/<end_of_turn>/g, "");
  out = out.replace(/<start_of_turn>.*$/g, "");
  return out.trim();
}

class TranslateEngine {
  private status: TranslateEngineStatus = { state: "idle", message: "" };
  private listeners = new Set<Listener>();
  private llm: {
    generateResponse: (
      prompt: string,
      cb?: (partial: string, done: boolean) => void
    ) => Promise<string>;
  } | null = null;
  private loadPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  /** Serializes generateResponse calls — the MediaPipe session is single-turn. */
  private queue: Promise<unknown> = Promise.resolve();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }

  private emit(state: TranslateEngineState, message: string, extra?: Partial<TranslateEngineStatus>) {
    this.status = { state, message, ...extra };
    this.listeners.forEach((l) => l(this.status));
  }

  get webGPUSupported(): boolean {
    if (typeof window === "undefined") return false;
    return "gpu" in navigator && Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
  }

  get configured(): boolean {
    return Boolean(modelManifest.translation?.url);
  }

  /** Abort an in-flight model download (kept available for UI cancel). */
  cancelDownload(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  /**
   * Make the engine ready: capability check -> OPFS-cached artifact ->
   * MediaPipe session. Concurrent callers share one load.
   */
  async ensureReady(): Promise<void> {
    if (this.llm) return;
    if (this.loadPromise) return this.loadPromise;

    this.loadPromise = (async () => {
      if (!this.configured) {
        throw new Error(
          "The translation model artifact is not configured. Ask the operator to set the TranslateGemma URL."
        );
      }
      if (!this.webGPUSupported) {
        throw new Error(
          "WebGPU is unavailable in this browser. On-device translation needs a WebGPU browser such as Chrome, Edge, or updated Safari."
        );
      }

      const url = modelManifest.translation!.url!;
      const total = modelManifest.translation?.sizeBytes;

      let assetUrl: string;
      try {
        assetUrl = await this.resolveModelAsset(url, total);
      } catch (err) {
        this.loadPromise = null;
        if ((err as Error)?.name === "AbortError") {
          this.emit("idle", "Download cancelled.");
          throw new Error("Download cancelled.");
        }
        this.emit("error", "Model download failed. Check the connection and try again.");
        throw err instanceof Error ? err : new Error(String(err));
      }

      this.emit("loading", "Loading translation model…");
      try {
        const { FilesetResolver, LlmInference } = await import("@mediapipe/tasks-genai");
        const fileset = await FilesetResolver.forGenAiTasks(WASM_BASE);
        this.llm = (await LlmInference.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: assetUrl },
          maxTokens: 1024,
          temperature: 0.1,
          topK: 1,
          randomSeed: 7,
        })) as unknown as TranslateEngine["llm"];
        this.emit("ready", "On-device translation ready.");
      } catch (err) {
        this.llm = null;
        this.loadPromise = null;
        this.emit("error", "The translation model could not start on this device.");
        throw err instanceof Error ? err : new Error(String(err));
      }
    })();

    return this.loadPromise;
  }

  /** OPFS cache -> streaming download with progress -> asset URL. */
  private async resolveModelAsset(
    url: string,
    knownTotal?: number
  ): Promise<string> {
    // 1. Cached copy?
    const cached = await this.readOpfsCachedFile().catch(() => null);
    if (cached) return cached;

    // 2. Stream the download so the UI can show progress.
    this.abortController = new AbortController();
    const res = await fetch(url, { signal: this.abortController.signal });
    if (!res.ok || !res.body) {
      throw new Error(`Model download failed (HTTP ${res.status}).`);
    }
    const total = Number(res.headers.get("content-length")) || knownTotal || 0;

    let writable: FileSystemWritableFileStream | null = null;
    let opfsDir: FileSystemDirectoryHandle | null = null;
    try {
      opfsDir = await navigator.storage.getDirectory();
      const handle = await opfsDir.getFileHandle(OPFS_FILE_NAME, { create: true });
      writable = await handle.createWritable();
    } catch {
      writable = null; // OPFS unavailable — memory fallback below
    }

    const reader = res.body.getReader();
    const memoryChunks: Uint8Array[] = [];
    let received = 0;
    this.emit("downloading", "Downloading translation model…", {
      progress: 0,
      receivedBytes: 0,
      totalBytes: total || undefined,
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (writable) {
        await writable.write(value);
      } else {
        memoryChunks.push(value);
      }
      this.emit("downloading", "Downloading translation model…", {
        progress: total ? received / total : undefined,
        receivedBytes: received,
        totalBytes: total || undefined,
      });
    }

    if (writable) {
      await writable.close();
      const file = await this.readOpfsCachedFile();
      if (file) return file;
      throw new Error("Cached model file could not be reopened.");
    }

    // Last resort without OPFS: hand MediaPipe an in-memory blob.
    const blob = new Blob(memoryChunks as BlobPart[]);
    return URL.createObjectURL(blob);
  }

  private async readOpfsCachedFile(): Promise<string | null> {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
    const dir = await navigator.storage.getDirectory();
    const handle = await dir
      .getFileHandle(OPFS_FILE_NAME, { create: false })
      .catch(() => null);
    if (!handle) return null;
    const file = await handle.getFile();
    // Guard against a truncated leftover from a cancelled download.
    const expected = modelManifest.translation?.sizeBytes ?? 0;
    if (file.size === 0 || (expected > 0 && file.size < expected * 0.98)) return null;
    return URL.createObjectURL(file);
  }

  /**
   * Translate one text. Calls are serialized; partial output streams to
   * `onPartial`. Returns the final translation text.
   */
  async translate(req: TranslateRequest): Promise<string> {
    const run = this.queue.then(() => this.runTranslation(req));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runTranslation(req: TranslateRequest): Promise<string> {
    if (!this.llm) {
      throw new Error("Translation model is not loaded yet.");
    }
    const prompt = buildTranslatePrompt(req);
    let lastPartial = "";
    let failure: unknown = null;
    try {
      const finalText = await this.llm.generateResponse(prompt, (partial) => {
        if (partial && partial !== lastPartial) {
          lastPartial = partial;
          req.onPartial?.(cleanTranslationOutput(partial));
        }
      });
      const cleaned = cleanTranslationOutput(finalText || lastPartial);
      req.onPartial?.(cleaned);
      return cleaned;
    } catch (err) {
      failure = err;
    }
    if (failure) {
      throw failure instanceof Error ? failure : new Error(String(failure));
    }
    return lastPartial;
  }
}

export const translateEngine = new TranslateEngine();

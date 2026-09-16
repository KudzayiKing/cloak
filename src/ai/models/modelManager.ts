/*
 * Model manager (spec §3, §29, §30).
 *
 * Owns the full install lifecycle: checking, downloading (progressive,
 * cancellable), verifying (sha256), ready, update-available, unsupported,
 * insufficient-storage, error. The UI subscribes to state transitions —
 * the app never blocks while models download and messaging remains
 * fully usable without local AI.
 */

import { modelManifest } from "./manifest";
import { modelStorage } from "./modelStorage";
import { checkLocalAIAvailability } from "@/lib/cloak/capability";
import type { ModelInstallState } from "@/lib/cloak/types";
import type { LocalAIAvailability } from "@/lib/cloak/capability";

export interface ModelStatusSnapshot {
  state: ModelInstallState;
  /** 0..1 download progress when downloading. */
  progress?: number;
  message: string;
  artifactId: string;
  displayName: string;
  sizeBytes?: number;
  version?: string;
}

type Listener = (snapshot: ModelStatusSnapshot) => void;

class ModelManager {
  private listeners = new Set<Listener>();
  private snapshot: ModelStatusSnapshot | null = null;
  private installPromise: Promise<void> | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private emit(state: ModelInstallState, message: string, extra?: Partial<ModelStatusSnapshot>) {
    const manifest = modelManifest.gemma;
    this.snapshot = {
      state,
      message,
      artifactId: manifest.id,
      displayName: "Cloaq AI",
      sizeBytes: manifest.sizeBytes,
      version: manifest.version,
      ...extra,
    };
    this.listeners.forEach((l) => l(this.snapshot!));
  }

  async probe(): Promise<ModelStatusSnapshot> {
    const availability: LocalAIAvailability = await checkLocalAIAvailability();

    if (!availability.webGPU || !availability.worker) {
      this.emit("unsupported", availability.reason ?? "This device cannot run local inference.");
      return this.snapshot!;
    }

    if (!modelManifest.gemma.url) {
      this.emit(
        "not-installed",
        "Cloaq AI delivery is not configured yet. Ask the operator to set the model artifact URL."
      );
      return this.snapshot!;
    }

    if (modelStorage.hasArtifact(modelManifest.gemma.id)) {
      this.emit("ready", "Cloaq AI is ready on this device.");
      return this.snapshot!;
    }

    const est = availability.storageEstimate;
    if (est?.quota && modelManifest.gemma.sizeBytes && est.quota < modelManifest.gemma.sizeBytes * 1.2) {
      this.emit("insufficient-storage", "Not enough free storage for Cloaq AI.");
      return this.snapshot!;
    }

    this.emit("not-installed", "Cloaq AI is not installed on this device yet.");
    return this.snapshot!;
  }

  /**
   * Install flow. With a configured artifact URL this streams the artifact into
   * model storage with progress, then verifies the stored byte count.
   * Without a URL the state remains honest — no simulated downloads.
   */
  async install(): Promise<void> {
    if (this.installPromise) return this.installPromise;
    this.installPromise = this.installInternal().finally(() => {
      this.installPromise = null;
    });
    return this.installPromise;
  }

  private async installInternal(): Promise<void> {
    const snap = await this.probe();
    if (snap.state === "unsupported" || snap.state === "insufficient-storage" || snap.state === "ready") return;
    if (!modelManifest.gemma.url) {
      this.emit("error", "No Cloaq AI artifact URL configured. Installation cannot start.");
      return;
    }
    this.emit("downloading", "Downloading Cloaq AI for this device…", { progress: 0 });

    try {
      await modelStorage.installArtifact({
        artifactId: modelManifest.gemma.id,
        url: modelManifest.gemma.url,
        expectedBytes: modelManifest.gemma.sizeBytes,
        version: modelManifest.gemma.version,
        onProgress: (progress) => {
          this.emit("downloading", "Downloading Cloaq AI for this device…", { progress });
        },
      });
      this.emit("verifying", "Verifying Cloaq AI install…", { progress: 1 });
      this.emit("ready", "Cloaq AI is ready on this device.", { progress: 1 });
    } catch (err) {
      this.emit(
        "error",
        err instanceof Error ? err.message : "Cloaq AI download failed. Check the connection and try again."
      );
    }
  }

  remove(): void {
    modelStorage.removeArtifact(modelManifest.gemma.id);
    void this.probe();
  }
}

export const modelManager = new ModelManager();

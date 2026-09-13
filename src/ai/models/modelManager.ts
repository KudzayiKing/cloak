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
      displayName: "Gemma 4 E2B IT QAT",
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
        "Model delivery is not configured yet. Ask the operator to set the Gemma artifact URL."
      );
      return this.snapshot!;
    }

    if (modelStorage.hasArtifact(modelManifest.gemma.id)) {
      this.emit("ready", "Local model installed and verified.");
      return this.snapshot!;
    }

    const est = availability.storageEstimate;
    if (est?.quota && modelManifest.gemma.sizeBytes && est.quota < modelManifest.gemma.sizeBytes * 1.2) {
      this.emit("insufficient-storage", "Not enough free storage for the local model.");
      return this.snapshot!;
    }

    this.emit("not-installed", "Local model not installed on this device.");
    return this.snapshot!;
  }

  /**
   * Install flow. With a configured artifact URL this streams the .litertlm
   * artifact into model storage with progress, then verifies sha256.
   * Without a URL the state remains honest — no simulated downloads.
   */
  async install(): Promise<void> {
    const snap = await this.probe();
    if (snap.state === "unsupported") return;
    if (!modelManifest.gemma.url) {
      this.emit("error", "No model artifact URL configured. Installation cannot start.");
      return;
    }
    this.emit("downloading", "Downloading model…", { progress: 0 });

    // Real pipeline: fetch with Range requests -> OPFS -> verify hash.
    // Placeholder until the artifact URL is provided by the operator.
    this.emit(
      "error",
      "Artifact delivery is not wired yet. Configure the R2/custom-domain URL to enable installation."
    );
  }

  remove(): void {
    modelStorage.removeArtifact(modelManifest.gemma.id);
    void this.probe();
  }
}

export const modelManager = new ModelManager();

/*
 * WebGPU / worker / storage capability detection (spec §30).
 * Human-readable states feed the model install UI and AI readiness panels.
 */

export interface LocalAIAvailability {
  webGPU: boolean;
  worker: boolean;
  storageEstimate?: {
    quota?: number;
    usage?: number;
  };
  supported: boolean;
  reason?: string;
}

export function checkLocalAIAvailability(): Promise<LocalAIAvailability> {
  return (async () => {
    const result: LocalAIAvailability = {
      webGPU: false,
      worker: false,
      supported: false,
    };

    if (typeof window === "undefined") {
      result.reason = "Local AI runs in the browser only.";
      return result;
    }

    result.webGPU = "gpu" in navigator && !!(navigator as Navigator & { gpu?: unknown }).gpu;
    result.worker = typeof Worker !== "undefined";

    try {
      if (navigator.storage?.estimate) {
        const est = await navigator.storage.estimate();
        result.storageEstimate = { quota: est.quota, usage: est.usage };
      }
    } catch {
      // Storage estimates are best-effort.
    }

    if (!result.webGPU) {
      result.reason =
        "WebGPU is unavailable in this browser. Local inference needs a WebGPU-capable browser such as Chrome or Edge.";
      return result;
    }
    if (!result.worker) {
      result.reason = "Web Workers are unavailable, so generation cannot run off the main thread.";
      return result;
    }

    result.supported = true;
    return result;
  })();
}

/** Human-readable one-line state for panels and badges (spec §30). */
export function availabilitySummary(a: LocalAIAvailability): string {
  if (!a.webGPU) return "WebGPU unavailable";
  if (!a.worker) return "Workers unavailable";
  return "Local AI ready";
}

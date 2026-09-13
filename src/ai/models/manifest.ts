/*
 * Model manifest (spec §3, §49).
 * Re-exported from runtime config so AI code never imports UI config.
 * R2 is model artifact delivery/storage ONLY — never an inference endpoint,
 * and never a holder of credentials in client code.
 */

import { MODEL_MANIFEST } from "@/lib/cloak/config";

export interface ModelManifest {
  gemma: {
    id: string;
    url?: string;
    sizeBytes?: number;
    version?: string;
    sha256?: string;
  };
  embedding?: {
    id: string;
    url?: string;
    sizeBytes?: number;
    version?: string;
    sha256?: string;
  };
  translation?: {
    id: string;
    url?: string;
    sizeBytes?: number;
    version?: string;
    sha256?: string;
  };
}

export const modelManifest: ModelManifest = {
  gemma: {
    id: MODEL_MANIFEST.gemma.id,
    url: MODEL_MANIFEST.gemma.url,
    sizeBytes: MODEL_MANIFEST.gemma.sizeBytes,
    version: MODEL_MANIFEST.gemma.version,
    sha256: MODEL_MANIFEST.gemma.sha256,
  },
  embedding: MODEL_MANIFEST.embedding
    ? {
        id: MODEL_MANIFEST.embedding.id,
        url: MODEL_MANIFEST.embedding.url,
        sizeBytes: MODEL_MANIFEST.embedding.sizeBytes,
        version: MODEL_MANIFEST.embedding.version,
        sha256: MODEL_MANIFEST.embedding.sha256,
      }
    : undefined,
  translation: MODEL_MANIFEST.translation
    ? {
        id: MODEL_MANIFEST.translation.id,
        url: MODEL_MANIFEST.translation.url,
        sizeBytes: MODEL_MANIFEST.translation.sizeBytes,
        version: MODEL_MANIFEST.translation.version,
        sha256: MODEL_MANIFEST.translation.sha256,
      }
    : undefined,
};

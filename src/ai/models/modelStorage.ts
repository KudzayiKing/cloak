/*
 * Model storage boundary (spec §3, §29).
 *
 * Artifacts are persisted through an appropriate browser storage mechanism
 * (OPFS/IndexedDB in production). Distinct from:
 *   - the service worker static shell cache (public/sw.js)
 *   - encrypted application data
 *
 * Current state: artifact presence probe only. The download/verify pipeline
 * activates once the owner configures the R2 artifact URL — no silent
 * multi-gigabyte fetches ever happen (spec §3).
 */

const ARTIFACT_KEY_PREFIX = "cloak-artifact:";

export const modelStorage = {
  hasArtifact(artifactId: string): boolean {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(ARTIFACT_KEY_PREFIX + artifactId) === "installed";
    } catch {
      return false;
    }
  },

  markInstalled(artifactId: string) {
    try {
      window.localStorage.setItem(ARTIFACT_KEY_PREFIX + artifactId, "installed");
    } catch {
      // quota errors surface through the model manager, not here
    }
  },

  removeArtifact(artifactId: string) {
    try {
      window.localStorage.removeItem(ARTIFACT_KEY_PREFIX + artifactId);
    } catch {
      // ignore
    }
  },
};

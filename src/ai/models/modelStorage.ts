/*
 * Model storage boundary (spec §3, §29).
 *
 * Artifacts are persisted in OPFS when the browser supports it. This stays
 * distinct from:
 *   - the service worker static shell cache (public/sw.js)
 *   - encrypted application data
 *
 * The tiny localStorage marker is only an index for quick readiness checks;
 * the artifact bytes live in browser-managed device storage.
 */

const ARTIFACT_KEY_PREFIX = "cloak-artifact:";
const MODEL_DIR = "cloak-model-artifacts";

export interface StoredArtifactMetadata {
  id: string;
  sizeBytes?: number;
  version?: string;
  installedAt: number;
}

export interface InstallArtifactInput {
  artifactId: string;
  url: string;
  expectedBytes?: number;
  version?: string;
  onProgress?: (progress: number, receivedBytes: number, totalBytes?: number) => void;
}

type FileSystemDirectoryHandleLike = {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
};

type FileSystemFileHandleLike = {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
  getFile(): Promise<File>;
};

type FileSystemWritableFileStreamLike = {
  write(chunk: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
};

function storageKey(artifactId: string): string {
  return ARTIFACT_KEY_PREFIX + artifactId;
}

function artifactFileName(artifactId: string): string {
  return `${artifactId.replace(/[^a-z0-9._-]/gi, "_")}.bin`;
}

async function modelDirectory(create: boolean): Promise<FileSystemDirectoryHandleLike> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandleLike>;
  };
  if (!storage.getDirectory) {
    throw new Error("Device storage for Cloaq AI is unavailable in this browser.");
  }
  const root = await storage.getDirectory();
  return root.getDirectoryHandle(MODEL_DIR, { create });
}

function readMetadata(artifactId: string): StoredArtifactMetadata | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(artifactId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredArtifactMetadata;
    return parsed?.id === artifactId ? parsed : null;
  } catch {
    return null;
  }
}

export const modelStorage = {
  hasArtifact(artifactId: string): boolean {
    return Boolean(readMetadata(artifactId));
  },

  markInstalled(artifact: Omit<StoredArtifactMetadata, "installedAt">) {
    try {
      window.localStorage.setItem(
        storageKey(artifact.id),
        JSON.stringify({ ...artifact, installedAt: Date.now() })
      );
    } catch {
      // quota errors surface through the model manager, not here
    }
  },

  async installArtifact(input: InstallArtifactInput): Promise<void> {
    const dir = await modelDirectory(true);
    const filename = artifactFileName(input.artifactId);
    const handle = await dir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    let receivedBytes = 0;
    let closed = false;

    try {
      const res = await fetch(input.url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Cloaq AI download failed (HTTP ${res.status}).`);
      }
      if (!res.body) {
        throw new Error("Cloaq AI download streaming is unavailable in this browser.");
      }

      const totalBytes =
        input.expectedBytes ??
        (Number(res.headers.get("content-length") || "") || undefined);
      const reader = res.body.getReader();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        await writable.write(value);
        if (totalBytes) {
          input.onProgress?.(Math.min(receivedBytes / totalBytes, 1), receivedBytes, totalBytes);
        }
      }

      await writable.close();
      closed = true;

      const file = await handle.getFile();
      const expected = input.expectedBytes;
      if (expected && file.size !== expected) {
        await dir.removeEntry(filename).catch(() => undefined);
        throw new Error("Cloaq AI download was incomplete. It will retry on the next launch.");
      }

      this.markInstalled({
        id: input.artifactId,
        sizeBytes: file.size,
        version: input.version,
      });
    } catch (err) {
      if (!closed) {
        await writable.abort?.().catch(() => undefined);
      }
      await dir.removeEntry(filename).catch(() => undefined);
      throw err;
    }
  },

  removeArtifact(artifactId: string) {
    try {
      window.localStorage.removeItem(storageKey(artifactId));
    } catch {
      // ignore
    }
    void modelDirectory(false)
      .then((dir) => dir.removeEntry(artifactFileName(artifactId)).catch(() => undefined))
      .catch(() => undefined);
  },
};

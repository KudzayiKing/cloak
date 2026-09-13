"use client";

/*
 * Per-message translation state for the long-press "Translate" action
 * (user request). In-memory ONLY — translations are never written to
 * localStorage or the server, and they vanish on refresh, matching the
 * device-transient privacy contract (message bodies never leave the
 * device during translation; the model runs in the browser via WebGPU).
 */

import { create } from "zustand";
import { translateEngine } from "@/ai/providers/translation/translate-engine";
import {
  detectSourceLanguageName,
  sourceLanguageCodeHint,
  translationLanguageByCode,
} from "@/lib/cloak/translation-languages";

export type TranslationStatus =
  | "preparing" // capability/model pipeline starting
  | "downloading" // one-time model download with progress
  | "loading" // model loading into GPU memory
  | "streaming" // translation tokens arriving
  | "done"
  | "error";

export interface MessageTranslation {
  status: TranslationStatus;
  targetName: string;
  sourceName: string;
  text: string;
  progress?: number; // 0..1 while downloading
  receivedBytes?: number;
  totalBytes?: number;
  error?: string;
}

interface TranslationStoreState {
  entries: Record<string, MessageTranslation>;
  /** While a translation exists, the bubble shows it; this flag flips the
      bubble back to the original text ("Show original"). */
  showOriginal: Record<string, boolean>;
  translateMessage: (messageId: string, text: string, targetCode: string) => Promise<void>;
  toggleShowOriginal: (messageId: string) => void;
  dismiss: (messageId: string) => void;
}

export const useTranslationStore = create<TranslationStoreState>()((set, get) => ({
  entries: {},
  showOriginal: {},

  translateMessage: async (messageId, text, targetCode) => {
    // Ignore repeat presses while this message is already translating.
    const existing = get().entries[messageId];
    if (existing && (existing.status === "downloading" || existing.status === "loading" || existing.status === "streaming" || existing.status === "preparing")) {
      return;
    }

    const target = translationLanguageByCode(targetCode);
    const sourceName = detectSourceLanguageName(text);

    const patch = (p: Partial<MessageTranslation>) =>
      set((s) => {
        const current = s.entries[messageId];
        if (!current) return s;
        return {
          entries: {
            ...s.entries,
            [messageId]: { ...current, ...p },
          },
          showOriginal: { ...s.showOriginal, [messageId]: false },
        };
      });

    set((s) => ({
      entries: {
        ...s.entries,
        [messageId]: {
          status: "preparing",
          text: "",
          targetName: target.name,
          sourceName,
        },
      },
      showOriginal: { ...s.showOriginal, [messageId]: false },
    }));

    try {
      // Drive the shared engine status into this entry (progress UI).
      // Multiple bubbles translating at once would each mirror it; the
      // engine serializes the actual work.
      const unsubscribe = translateEngine.subscribe((status) => {
        if (status.state === "downloading") {
          patch({
            status: "downloading",
            progress: status.progress,
            receivedBytes: status.receivedBytes,
            totalBytes: status.totalBytes,
          });
        } else if (status.state === "loading") {
          patch({ status: "loading" });
        } else if (status.state === "unsupported" || status.state === "error") {
          patch({ status: "error", error: status.message });
        }
      });

      try {
        await translateEngine.ensureReady();
      } catch (err) {
        unsubscribe();
        // The engine already emitted a friendly status message (download
        // failed, unsupported, cancelled) — only fall back to the raw
        // error when no error state arrived through the subscription.
        set((s) => {
          const current = s.entries[messageId];
          if (!current || current.status === "error") return s;
          return {
            entries: {
              ...s.entries,
              [messageId]: {
                ...current,
                status: "error",
                error: err instanceof Error ? err.message : "Translation could not start.",
              },
            },
          };
        });
        return;
      }

      patch({ status: "streaming", text: "" });
      try {
        await translateEngine.translate({
          text,
          sourceLanguageName: sourceName,
          sourceLanguageCode: sourceLanguageCodeHint(sourceName),
          targetLanguageName: target.name,
          targetLanguageCode: target.code,
          onPartial: (partial) => patch({ status: "streaming", text: partial }),
        });
        unsubscribe();
        // Final text arrives via the last onPartial; keep whatever is patched.
        set((s) => {
          const current = s.entries[messageId];
          if (!current || current.status === "error") return s;
          return { entries: { ...s.entries, [messageId]: { ...current, status: "done" } } };
        });
      } catch (err) {
        unsubscribe();
        set((s) => {
          const current = s.entries[messageId];
          if (!current || current.status === "error") return s;
          return {
            entries: {
              ...s.entries,
              [messageId]: {
                ...current,
                status: "error",
                error: err instanceof Error ? err.message : "Translation failed.",
              },
            },
          };
        });
      }
    } finally {
      // no persistent resources to release — engine stays warm for reuse
    }
  },

  toggleShowOriginal: (messageId) =>
    set((s) => ({
      showOriginal: { ...s.showOriginal, [messageId]: !s.showOriginal[messageId] },
    })),

  dismiss: (messageId) =>
    set((s) => {
      if (!(messageId in s.entries)) return s;
      const entries = { ...s.entries };
      delete entries[messageId];
      const showOriginal = { ...s.showOriginal };
      delete showOriginal[messageId];
      return { entries, showOriginal };
    }),
}));

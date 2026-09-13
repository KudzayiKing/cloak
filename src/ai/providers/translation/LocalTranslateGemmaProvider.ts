import type { TranslationProvider } from "./TranslationProvider";
import { modelManifest } from "@/ai/models/manifest";
import { translateEngine } from "./translate-engine";

/*
 * Local translation provider (spec §4) — now a real implementation on top
 * of the TranslateGemma engine (MediaPipe LLM Inference + WebGPU, model
 * cached on-device). `sourceLanguage`/`targetLanguage` accept either a
 * language NAME ("Russian") or a BCP-47 style code ("ru", "de-DE");
 * names are preferred by the prompt, codes are resolved as a fallback.
 */
export class LocalTranslateGemmaProvider implements TranslationProvider {
  readonly providerId = "LocalTranslateGemmaProvider";

  async isAvailable(): Promise<boolean> {
    return translateEngine.configured && translateEngine.webGPUSupported;
  }

  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string> {
    if (!modelManifest.translation?.url) {
      throw new Error(
        "Local translation artifact not configured for this language pair."
      );
    }
    await translateEngine.ensureReady();
    const { detectSourceLanguageName, sourceLanguageCodeHint } =
      await import("@/lib/cloak/translation-languages");
    const { translationLanguageByCode } = await import(
      "@/lib/cloak/translation-languages"
    );

    const sourceName =
      sourceLanguage && sourceLanguage.length > 2
        ? sourceLanguage
        : detectSourceLanguageName(text);
    const target = translationLanguageByCode(targetLanguage);
    return translateEngine.translate({
      text,
      sourceLanguageName: sourceName,
      sourceLanguageCode: sourceLanguageCodeHint(sourceName),
      targetLanguageName: target.name,
      targetLanguageCode: target.code,
    });
  }
}

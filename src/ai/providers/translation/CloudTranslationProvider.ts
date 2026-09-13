import type { TranslationProvider } from "./TranslationProvider";

export class CloudTranslationProvider implements TranslationProvider {
  readonly providerId = "CloudTranslationProvider";

  async isAvailable(): Promise<boolean> {
    return false; // Not provisioned; local-first by default (spec §7).
  }

  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string> {
    throw new Error("Cloud translation is not configured.");
  }
}

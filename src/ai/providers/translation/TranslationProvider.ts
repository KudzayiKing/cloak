/*
 * Translation provider abstraction (spec §4).
 * Local translation where supported; cloud translation only as an explicit,
 * consented fallback.
 */

export interface TranslationProvider {
  readonly providerId: string;
  isAvailable(): Promise<boolean>;
  initialize?(): Promise<void>;
  translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string>;
}

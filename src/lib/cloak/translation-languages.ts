/*
 * Translation languages (user request: "translate text to users chosen
 * language, add ability to pick language in the settings").
 *
 * TranslateGemma (the on-device model) ships with a fixed language set;
 * the entries below are the widely spoken subset offered in Settings.
 * `name` is the English display name used in the TranslateGemma prompt,
 * `code` is the BCP-47 style tag the model card uses (e.g. "de-DE").
 */

export interface TranslationLanguage {
  code: string;
  name: string;
}

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "pt", name: "Portuguese" },
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "ru", name: "Russian" },
  { code: "uk", name: "Ukrainian" },
  { code: "pl", name: "Polish" },
  { code: "cs", name: "Czech" },
  { code: "ro", name: "Romanian" },
  { code: "hu", name: "Hungarian" },
  { code: "el", name: "Greek" },
  { code: "sv", name: "Swedish" },
  { code: "da", name: "Danish" },
  { code: "fi", name: "Finnish" },
  { code: "no", name: "Norwegian" },
  { code: "tr", name: "Turkish" },
  { code: "ar", name: "Arabic" },
  { code: "he", name: "Hebrew" },
  { code: "fa", name: "Persian" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "ur", name: "Urdu" },
  { code: "zh-CN", name: "Chinese (Simplified)" },
  { code: "zh-TW", name: "Chinese (Traditional)" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "th", name: "Thai" },
  { code: "vi", name: "Vietnamese" },
  { code: "tl", name: "Tagalog" },
  { code: "sw", name: "Swahili" },
];

export function translationLanguageByCode(code: string): TranslationLanguage {
  return (
    TRANSLATION_LANGUAGES.find((l) => l.code === code) ??
    TRANSLATION_LANGUAGES[0]
  );
}

/*
 * Lightweight source-language detection for the translation prompt.
 * The model itself understands many languages, but the prompt template
 * asks for a source language name — a script-based guess covers the
 * common cases and Latin text defaults to English. Detection runs
 * entirely on-device and is a hint, not a guarantee.
 */

const SCRIPT_TESTS: Array<{ name: string; re: RegExp; refine?: (t: string) => string }> = [
  {
    // Cyrillic: Ukrainian has distinctive letters (ї і є ґ)
    name: "Cyrillic",
    re: /[\u0400-\u04FF]/,
    refine: (t) => (/[їієґЇІЄҐ]/.test(t) ? "Ukrainian" : "Russian"),
  },
  {
    name: "Japanese",
    re: /[\u3040-\u30FF]/,
  },
  {
    name: "Korean",
    re: /[\uAC00-\uD7AF\u1100-\u11FF]/,
  },
  {
    name: "Chinese (Simplified)",
    re: /[\u4E00-\u9FFF]/,
  },
  { name: "Arabic", re: /[\u0600-\u06FF]/ },
  { name: "Hebrew", re: /[\u0590-\u05FF]/ },
  { name: "Hindi", re: /[\u0900-\u097F]/ },
  { name: "Bengali", re: /[\u0980-\u09FF]/ },
  { name: "Thai", re: /[\u0E00-\u0E7F]/ },
  { name: "Greek", re: /[\u0370-\u03FF]/ },
];

/** Common-word scoring for Latin-script languages (best effort). */
const LATIN_HINTS: Array<{ name: string; words: RegExp }> = [
  { name: "Spanish", words: /\b(el|la|los|las|que|de|y|en|un|una|es|por|con|para|está|muy)\b/gi },
  { name: "French", words: /\b(le|la|les|de|et|en|un|une|est|que|qui|pour|dans|pas|vous|nous)\b/gi },
  { name: "German", words: /\b(der|die|das|und|ist|nicht|ein|eine|den|zu|mit|sich|auf|für|haben)\b/gi },
  { name: "Portuguese", words: /\b(o|a|os|as|que|de|e|em|um|uma|é|por|com|para|não|muito)\b/gi },
  { name: "Italian", words: /\b(il|la|i|le|che|di|e|in|un|una|è|per|con|non|molto|sono)\b/gi },
  { name: "Dutch", words: /\b(de|het|een|en|van|is|niet|dat|op|met|voor|zijn|maar|ook)\b/gi },
  { name: "Turkish", words: /\b(bir|ve|bu|için|ile|de|da|olan|gibi|ama|daha|çok|var|yok)\b/gi },
  { name: "Polish", words: /\b(nie|jest|się|to|na|do|jak|że|tak|ale|lub|przez|dla|tego)\b/gi },
  { name: "Indonesian", words: /\b(yang|dan|di|ini|itu|dengan|untuk|tidak|adalah|dari|akan|saya)\b/gi },
  { name: "Vietnamese", words: /\b(của|và|là|không|có|được|người|cho|này|với|trong|một)\b/gi },
];

/**
 * Best-effort source language NAME for the TranslateGemma prompt.
 * Returns the English name (e.g. "Russian") — never empty.
 */
export function detectSourceLanguageName(text: string): string {
  if (!text.trim()) return "English";

  for (const script of SCRIPT_TESTS) {
    if (script.re.test(text)) {
      if (script.refine) return script.refine(text);
      // Arabic script: Persian has distinctive letters (پ چ ژ گ)
      if (script.name === "Arabic" && /[پچژگ]/.test(text)) return "Persian";
      return script.name;
    }
  }

  // Latin scripts: score hint words
  let best = "English";
  let bestScore = 0;
  for (const hint of LATIN_HINTS) {
    const matches = text.match(hint.words);
    const score = matches ? matches.length : 0;
    if (score > bestScore) {
      bestScore = score;
      best = hint.name;
    }
  }
  return best;
}

/** BCP-47 style code hint for a source language NAME (prompt hint only). */
export function sourceLanguageCodeHint(name: string): string {
  const known = TRANSLATION_LANGUAGES.find((l) => l.name === name);
  if (known) return known.code;
  return "en";
}

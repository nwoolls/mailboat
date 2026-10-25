/**
 * Languages for translating (AI Spike 2): what they're called, which to
 * offer, and the Mac's own. Codes are BCP 47 ("fr", "en-US", "zh-TW").
 */

/** Offered when Apple's list can't be had (no helper on this Mac). */
export const COMMON_LANGUAGES = [
  "ar",
  "da",
  "de",
  "en",
  "es",
  "fi",
  "fr",
  "he",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "nb",
  "nl",
  "pl",
  "pt",
  "ru",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh",
  "zh-TW",
];

/** The language part of a code: "en-US" → "en". */
export function baseLanguage(code: string): string {
  return code.split(/[-_]/)[0]!.toLowerCase();
}

export function sameLanguage(a: string, b: string): boolean {
  return baseLanguage(a) === baseLanguage(b);
}

/** "fr" → "French", in the Mac's language. */
export function languageName(code: string, locale = navigator.language): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The name and code together, for a model: "French (fr)". */
export function languageLabel(code: string, locale = navigator.language): string {
  return `${languageName(code, locale)} (${code})`;
}

/**
 * The languages to choose from: one per language (regional variants
 * folded in, except Traditional Chinese, which is written differently),
 * by name.
 */
export function pickerLanguages(
  codes: string[],
  locale = navigator.language,
): { code: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const c of codes.length ? codes : COMMON_LANGUAGES) {
    const key = /^zh-(TW|HK|Hant)/i.test(c) ? "zh-TW" : baseLanguage(c);
    if (!seen.has(key)) seen.set(key, key);
  }
  return [...seen.values()]
    .map((code) => ({ code, name: languageName(code, locale) }))
    .toSorted((a, b) => a.name.localeCompare(b.name, locale));
}

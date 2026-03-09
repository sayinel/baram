import en from "./en.json";
import ko from "./ko.json";

const translations: Record<string, Record<string, string>> = { en, ko };

export type Locale = "en" | "ko";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ko: "\uD55C\uAD6D\uC5B4",
};

export const AVAILABLE_LOCALES: Locale[] = ["en", "ko"];

/**
 * Get a translated string for the given key and locale.
 * Supports simple {variable} interpolation.
 */
export function t(
  key: string,
  locale: Locale,
  params?: Record<string, string>,
): string {
  let value = translations[locale]?.[key] ?? translations.en?.[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{${k}}`, v);
    }
  }
  return value;
}

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
 * BCP-47 tag for `Intl` APIs (dates, month and weekday names, numbers).
 *
 * Derived from the app locale, NOT from the OS: the journal used to format dates with a
 * hardcoded `"ko-KR"`, so an English UI printed Korean dates. Falling back to the runtime
 * default instead would make the same entry read differently on two machines that have the
 * same in-app language set, which is the setting the user actually chose.
 */
export const INTL_LOCALES: Record<Locale, string> = {
  en: "en-US",
  ko: "ko-KR",
};

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

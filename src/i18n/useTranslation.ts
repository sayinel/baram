import { useCallback } from "react";

import type { Locale } from "./index";

import { useSettingsStore } from "../stores/settings/store";
import { t } from "./index";

/**
 * The locale-bound translate function `useTranslation` hands back.
 *
 * Named so a helper taking it as a parameter does not have to spell the signature inline:
 * `(key: string, params?: …) => string` immediately before a generic return type puts a
 * `>` … `<` pair in the source, which the JSX-prose scanner in
 * `components/plugins/__tests__/plugin-ui-i18n.test.tsx` reads as hardcoded English.
 */
export type Translate = (
  key: string,
  params?: Record<string, string>,
) => string;

/**
 * Hook that returns a translation function bound to the current locale.
 * Usage: const { t } = useTranslation();
 *        t("settings.title")
 *        t("settings.search.empty", { query: "foo" })
 */
export function useTranslation() {
  const locale = useSettingsStore((s) => s.locale) as Locale;

  const translate = useCallback(
    (key: string, params?: Record<string, string>) => t(key, locale, params),
    [locale],
  );

  return { t: translate, locale };
}

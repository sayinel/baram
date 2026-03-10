import { useCallback } from "react";

import type { Locale } from "./index";

import { useSettingsStore } from "../stores/settings-store";
import { t } from "./index";

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

import type { Locale } from "../../../i18n";

import { useShallow } from "zustand/shallow";

import { AVAILABLE_LOCALES, LOCALE_LABELS } from "../../../i18n";
import { useTranslation } from "../../../i18n/useTranslation";
import { useSettingsStore } from "../../../stores/settings/store";
import { SettingsRow, SettingsSectionHeader } from "../settings-shared";

export function LanguageTab() {
  const { locale, setLocale } = useSettingsStore(
    useShallow((s) => ({
      locale: s.locale,
      setLocale: s.setLocale,
    })),
  );
  const { t } = useTranslation();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.language.title")} />

      <SettingsRow
        description={t("settings.language.interface.desc")}
        label={t("settings.language.interface")}
      >
        <select
          className="settings-select"
          onChange={(e) => setLocale(e.target.value)}
          value={locale}
        >
          {AVAILABLE_LOCALES.map((loc: Locale) => (
            <option key={loc} value={loc}>
              {LOCALE_LABELS[loc]}
            </option>
          ))}
        </select>
      </SettingsRow>

      <div className="settings-row-description language-reload-notice">
        {t("settings.language.reloadNotice")}
      </div>
    </div>
  );
}

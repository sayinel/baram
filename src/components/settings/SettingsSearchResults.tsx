import type { SearchableSetting, SettingsTab } from "./settings-registry";

// SettingsSearchResults — renders grouped search results with inline controls
import { useTranslation } from "../../i18n/useTranslation";
import { SearchSettingControl } from "./SearchSettingControl";
import { SettingsSectionHeader } from "./settings-shared";

interface SettingsSearchResultsProps {
  grouped: Map<SettingsTab, SearchableSetting[]> | null;
  onNavigate: (tab: SettingsTab) => void;
  query: string;
}

export function SettingsSearchResults({
  grouped,
  query,
  onNavigate,
}: SettingsSearchResultsProps) {
  const { t } = useTranslation();

  if (!grouped || grouped.size === 0) {
    return (
      <div className="settings-search-empty">
        {t("settings.search.empty").replace("{query}", query)}
      </div>
    );
  }

  return (
    <div className="settings-section">
      {Array.from(grouped.entries()).map(([category, items]) => (
        <div key={category}>
          <SettingsSectionHeader title={t(`settings.tab.${category}`)} />
          {items.map((item) => (
            <div className="settings-search-result-row" key={item.id}>
              <div className="settings-row-info">
                <span className="settings-row-label">{t(item.label)}</span>
                <span className="settings-row-description">
                  {t(item.section)}
                  {/* An entry with no description text (e.g. the app version
                      row) gets no trailing separator. */}
                  {item.description && (
                    <>
                      {" "}
                      &middot;{" "}
                      {/* item.description may carry a {value} placeholder
                          (e.g. settings.ai.debounce.desc) — substituting the
                          control's live value unconditionally is harmless for
                          every other entry, since t() only replaces a token
                          that is actually present in the string. An entry
                          whose description has one must not use a selector
                          that returns null (settings-search-coverage.test.ts). */}
                      {t(item.description, {
                        value: String(item.control.storeSelector()),
                      })}
                    </>
                  )}
                </span>
              </div>
              <div className="settings-row-control">
                <SearchSettingControl
                  control={item.control}
                  onNavigate={() => onNavigate(category)}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

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
                  {t(item.section)} &middot; {t(item.description)}
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

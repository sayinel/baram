// Settings Modal — 9-tab settings (General, Editor, Appearance, Markdown, AI, ActivityBar, Language, Keybindings, Plugins)
// Obsidian-style layout: label + description per row, section headers for grouping
import { useMemo, useState } from "react";

import type { SearchableSetting, SettingsTab } from "./settings-registry";

import { useTranslation } from "../../i18n/useTranslation";
import { useUIStore } from "../../stores/ui/ui";
import { PluginMarketplace } from "../plugins/PluginMarketplace";
import { useSettingsRegistry } from "./settings-registry";
import { SettingsSearchResults } from "./SettingsSearchResults";
import { ActivityBarTab } from "./tabs/ActivityBarTab";
import { AITab } from "./tabs/AITab";
import { AppearanceTab } from "./tabs/AppearanceTab";
import { EditorTab } from "./tabs/EditorTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { KeybindingsTab } from "./tabs/KeybindingsTab";
import { LanguageTab } from "./tabs/LanguageTab";
import { MarkdownTab } from "./tabs/MarkdownTab";

const TABS: { icon: string; id: SettingsTab; label: string }[] = [
  { id: "general", label: "General", icon: "\u2699" },
  { id: "editor", label: "Editor", icon: "\u270E" },
  { id: "appearance", label: "Appearance", icon: "\u25D1" },
  { id: "markdown", label: "Markdown", icon: "M\u2193" },
  { id: "ai", label: "AI", icon: "\u2726" },
  { id: "activitybar", label: "Activity Bar", icon: "\u25A4" },
  { id: "language", label: "Language", icon: "\uD83C\uDF10" },
  { id: "keybindings", label: "Keybindings", icon: "\u2328" },
  { id: "plugins", label: "Plugins", icon: "\uD83E\uDDE9" },
];

export function SettingsModal() {
  const { settingsOpen, toggleSettings } = useUIStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [searchQuery, setSearchQuery] = useState("");
  const { t } = useTranslation();
  const registry = useSettingsRegistry();

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return registry.filter(
      (s) =>
        t(s.label).toLowerCase().includes(q) ||
        t(s.description).toLowerCase().includes(q) ||
        t(s.section).toLowerCase().includes(q) ||
        (s.keywords ?? []).some((k) => k.includes(q)),
    );
  }, [searchQuery, t, registry]);

  const groupedResults = useMemo(() => {
    if (!searchResults) return null;
    const map = new Map<SettingsTab, SearchableSetting[]>();
    for (const r of searchResults) {
      const list = map.get(r.category) ?? [];
      list.push(r);
      map.set(r.category, list);
    }
    return map;
  }, [searchResults]);

  if (!settingsOpen) return null;

  return (
    <div className="settings-overlay" onClick={toggleSettings}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">{t("settings.title")}</h2>
          <div className="settings-search-wrapper">
            <input
              className="settings-search"
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("settings.search.placeholder")}
              spellCheck={false}
              type="text"
              value={searchQuery}
            />
            {searchQuery && (
              <button
                className="settings-search-clear"
                onClick={() => setSearchQuery("")}
              >
                {"\u00D7"}
              </button>
            )}
          </div>
          <button
            className="settings-close"
            onClick={toggleSettings}
            title={t("common.close")}
          >
            {"\u00D7"}
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            {TABS.map((tab) => (
              <button
                className={`settings-nav-item ${activeTab === tab.id ? "settings-nav-active" : ""}`}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="settings-nav-icon">{tab.icon}</span>
                {t(`settings.tab.${tab.id}`)}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {searchQuery.trim() ? (
              <SettingsSearchResults
                grouped={groupedResults}
                onNavigate={(tab) => {
                  setActiveTab(tab);
                  setSearchQuery("");
                }}
                query={searchQuery}
              />
            ) : (
              <>
                {activeTab === "general" && <GeneralTab />}
                {activeTab === "editor" && <EditorTab />}
                {activeTab === "appearance" && <AppearanceTab />}
                {activeTab === "markdown" && <MarkdownTab />}
                {activeTab === "ai" && <AITab />}
                {activeTab === "activitybar" && <ActivityBarTab />}
                {activeTab === "language" && <LanguageTab />}
                {activeTab === "keybindings" && <KeybindingsTab />}
                {activeTab === "plugins" && (
                  <div className="settings-section">
                    <PluginMarketplace />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

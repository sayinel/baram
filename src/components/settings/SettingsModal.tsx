// Settings Modal — General/Features/System nav groups (§342), plus Plugins.
// Obsidian-style layout: label + description per row, section headers for grouping
import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { FeatureKey } from "../../stores/settings/feature-keys";
import type { SearchableSetting, SettingsTab } from "./settings-registry";

import { CircleCheck, Sparkles } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { useFeatureFlags } from "../../stores/settings/features";
import { useUIStore } from "../../stores/ui/ui";
import { PluginMarketplace } from "../plugins/PluginMarketplace";
import { PluginSettingsTabHost } from "./PluginSettingsTabHost";
import { useSettingsRegistry } from "./settings-registry";
import { SettingsSearchResults } from "./SettingsSearchResults";
import { ActivityBarTab } from "./tabs/ActivityBarTab";
import { AITab } from "./tabs/AITab";
import { AppearanceTab } from "./tabs/AppearanceTab";
import { EditorTab } from "./tabs/EditorTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { JournalTab } from "./tabs/JournalTab";
import { KeybindingsTab } from "./tabs/KeybindingsTab";
import { LanguageTab } from "./tabs/LanguageTab";
import { MarkdownTab } from "./tabs/MarkdownTab";
import { TasksTab } from "./tabs/TasksTab";
import { VaultTab } from "./tabs/VaultTab";
import { ZettelkastenTab } from "./tabs/ZettelkastenTab";

// eslint-disable-next-line react-refresh/only-export-components
export const SETTINGS_TAB_GROUPS: {
  id: "features" | "general" | "system";
  labelKey: string;
}[] = [
  { id: "general", labelKey: "settings.group.general" },
  { id: "features", labelKey: "settings.group.features" },
  { id: "system", labelKey: "settings.group.system" },
];

// eslint-disable-next-line react-refresh/only-export-components
export const TABS: {
  /** 이 탭이 기능 하나에 속하면 그 키. 흐리게 표시할지 판정한다. */
  feature?: FeatureKey;
  group: "features" | "general" | "system";
  /** 문자 글리프이거나 아이콘 컴포넌트. 두 탭은 다른 표면과 **같은 아이콘**을 쓴다:
   *  tasks 는 활동표시줄(`ActivityBar.tsx` 의 `CircleCheck`), ai 는 블록 팝업의
   *  AI 버튼(`image-view.tsx` 등의 `Sparkles`). lucide 는 `currentColor` 를 쓰므로
   *  모노톤으로 테마 색을 그대로 따른다 — 이모지는 자기 색을 갖고 온다. */
  icon: ReactNode;
  id: SettingsTab;
}[] = [
  { id: "general", group: "general", icon: "⚙" },
  { id: "editor", group: "general", icon: "✎" },
  { id: "appearance", group: "general", icon: "◑" },
  { id: "markdown", group: "general", icon: "M↓" },
  { id: "language", group: "general", icon: "🌐" },
  { id: "keybindings", group: "general", icon: "⌨" },
  { id: "journal", group: "features", icon: "📓", feature: "journal" },
  {
    id: "zettelkasten",
    group: "features",
    icon: "🗂",
    feature: "zettelkasten",
  },
  {
    id: "tasks",
    group: "features",
    icon: <CircleCheck size={14} strokeWidth={1.5} />,
    feature: "tasks",
  },
  {
    id: "ai",
    group: "features",
    icon: <Sparkles size={14} strokeWidth={1.5} />,
    feature: "ai",
  },
  { id: "activitybar", group: "system", icon: "▤" },
  { id: "plugins", group: "system", icon: "🧩" },
  { id: "vault", group: "system", icon: "📦" },
];

export function SettingsModal() {
  const { settingsOpen, toggleSettings } = useUIStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [activePluginTab, setActivePluginTab] = useState<null | string>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { t } = useTranslation();
  const registry = useSettingsRegistry();
  const pluginTabs = usePluginUIStore(useShallow((s) => s.settingsTabs));
  const featureFlags = useFeatureFlags();

  useEffect(() => {
    if (
      activePluginTab &&
      !pluginTabs.some((t) => t.tabId === activePluginTab)
    ) {
      setActivePluginTab(null);
    }
  }, [pluginTabs, activePluginTab]);

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
        <div className="settings-header flex-header">
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
                {"×"}
              </button>
            )}
          </div>
          <button
            className="settings-close icon-btn"
            onClick={toggleSettings}
            title={t("common.close")}
          >
            {"×"}
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            {SETTINGS_TAB_GROUPS.map((group) => (
              <Fragment key={group.id}>
                <div className="settings-nav-group">{t(group.labelKey)}</div>
                {TABS.filter((tab) => tab.group === group.id).map((tab) => (
                  <button
                    className={[
                      "settings-nav-item",
                      activeTab === tab.id && !activePluginTab
                        ? "settings-nav-active"
                        : "",
                      // §342 규칙 1 — 탭은 숨기지 않고 흐리게만. 숨기면 되켤 수 없다.
                      tab.feature && !featureFlags[tab.feature]
                        ? "settings-nav-item--off"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id);
                      setActivePluginTab(null);
                    }}
                  >
                    <span className="settings-nav-icon">{tab.icon}</span>
                    {t(`settings.tab.${tab.id}`)}
                  </button>
                ))}
              </Fragment>
            ))}
            {pluginTabs.length > 0 && (
              <>
                <div className="settings-nav-group">
                  {t("settings.group.plugins")}
                </div>
                {pluginTabs.map((tab) => (
                  <button
                    className={`settings-nav-item ${activePluginTab === tab.tabId ? "settings-nav-active" : ""}`}
                    key={tab.tabId}
                    onClick={() => setActivePluginTab(tab.tabId)}
                  >
                    <span className="settings-nav-icon">{"🧩"}</span>
                    {tab.title}
                  </button>
                ))}
              </>
            )}
          </nav>
          <div className="settings-content">
            {searchQuery.trim() ? (
              <SettingsSearchResults
                grouped={groupedResults}
                onNavigate={(tab) => {
                  setActiveTab(tab);
                  setActivePluginTab(null);
                  setSearchQuery("");
                }}
                query={searchQuery}
              />
            ) : activePluginTab ? (
              <div className="settings-section">
                <PluginSettingsTabHost tabId={activePluginTab} />
              </div>
            ) : (
              <>
                {activeTab === "general" && <GeneralTab />}
                {activeTab === "editor" && <EditorTab />}
                {activeTab === "appearance" && <AppearanceTab />}
                {activeTab === "markdown" && <MarkdownTab />}
                {activeTab === "journal" && <JournalTab />}
                {activeTab === "zettelkasten" && <ZettelkastenTab />}
                {activeTab === "tasks" && <TasksTab />}
                {activeTab === "ai" && <AITab />}
                {activeTab === "activitybar" && <ActivityBarTab />}
                {activeTab === "language" && <LanguageTab />}
                {activeTab === "keybindings" && <KeybindingsTab />}
                {activeTab === "plugins" && (
                  <div className="settings-section">
                    <PluginMarketplace />
                  </div>
                )}
                {activeTab === "vault" && <VaultTab />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

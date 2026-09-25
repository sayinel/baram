// Settings Modal — General/Features/System nav groups (§342), plus Plugins.
// Obsidian-style layout: label + description per row, section headers for grouping
import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import type { FeatureKey } from "../../stores/settings/feature-keys";
import type { SearchableSetting, SettingsTab } from "./settings-registry";

import {
  CircleCheck,
  Folder,
  Globe,
  Keyboard,
  Notebook,
  Palette,
  PanelsTopLeft,
  Pencil,
  Puzzle,
  Settings,
  Sparkles,
  SquareM,
  StickyNote,
  X,
} from "lucide-react";
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

/** 설정 내비의 아이콘 크기·굵기. `.settings-nav-icon` 이 20px 박스이므로 14px 이 맞고,
 *  굵기는 활동표시줄(`ICON_PROPS`)과 같은 1.5 다. 한 곳에서 정해 탭마다 어긋나지 않게 한다. */
const TAB_ICON = { size: 14, strokeWidth: 1.5 } as const;

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
  /** lucide 아이콘 요소. 문자 글리프는 받지 않는다 — 글리프는 svg 와 크기·굵기가 달라
   *  열이 들쭉날쭉했고(`▤ ✎ ◑`), 두 글자짜리 `M↓` 는 20px 칸을 넘쳤다(0.8rem 에서 실측
   *  22px). 편집기·마크다운은 그 글리프를 옮긴 `Pencil`·`SquareM` 이다 — lucide 에
   *  Markdown 마크가 없어 테두리 안의 M 인 `SquareM` 이 가장 가깝다. ✎·◑·M↓ 셋 중 외관만
   *  모양을 옮기지 않았다: ◑ 에 해당하는 `Contrast` 는 반쪽이 외곽선뿐이라 14px 에서 원 안의
   *  "D" 로 읽혀, 테마·강조색을 다루는 탭의 뜻대로 `Palette` 를 쓴다.
   *  다음 탭은 같은 것을 이미 그리는 다른 표면과 **같은 아이콘**을 쓴다:
   *  - tasks·zettelkasten·plugins — 활동표시줄(`ActivityBar.tsx` 의 `CircleCheck`·
   *    `StickyNote`·`Puzzle`)
   *  - ai — 블록 팝업의 AI 버튼(`image-view.tsx` 등의 `Sparkles`)
   *  - activitybar(화면 배치) — 이 탭이 담는 화면구성 프리셋을 여는 상태 표시줄
   *    버튼(`StatusBar.tsx` 의 `PanelsTopLeft`). 예전 `▤` 는 이 탭이 활동표시줄만
   *    다루던 시절의 글리프였다
   *  - vault — 최근 폴더 목록이 볼트를 그리는 `Folder`(`ContextAddMenu.tsx` — 볼트는
   *    아이콘이 아니라 배지로 구별한다). lucide 의 `Vault`(금고 문)는 14px 에서
   *    다이얼 살 넷이 네모 속 X 로 읽혀 쓰지 않는다
   *  lucide 는 `currentColor` 를 쓰므로 모노톤으로 테마 색을 그대로 따른다 — 이모지는
   *  자기 색을 갖고 온다. */
  icon: ReactElement;
  id: SettingsTab;
}[] = [
  { id: "general", group: "general", icon: <Settings {...TAB_ICON} /> },
  { id: "editor", group: "general", icon: <Pencil {...TAB_ICON} /> },
  { id: "appearance", group: "general", icon: <Palette {...TAB_ICON} /> },
  { id: "markdown", group: "general", icon: <SquareM {...TAB_ICON} /> },
  { id: "language", group: "general", icon: <Globe {...TAB_ICON} /> },
  { id: "keybindings", group: "general", icon: <Keyboard {...TAB_ICON} /> },
  {
    id: "journal",
    group: "features",
    icon: <Notebook {...TAB_ICON} />,
    feature: "journal",
  },
  {
    id: "zettelkasten",
    group: "features",
    icon: <StickyNote {...TAB_ICON} />,
    feature: "zettelkasten",
  },
  {
    id: "tasks",
    group: "features",
    icon: <CircleCheck {...TAB_ICON} />,
    feature: "tasks",
  },
  {
    id: "ai",
    group: "features",
    icon: <Sparkles {...TAB_ICON} />,
    feature: "ai",
  },
  { id: "activitybar", group: "system", icon: <PanelsTopLeft {...TAB_ICON} /> },
  { id: "plugins", group: "system", icon: <Puzzle {...TAB_ICON} /> },
  { id: "vault", group: "system", icon: <Folder {...TAB_ICON} /> },
];

export function SettingsModal() {
  const { settingsOpen, toggleSettings } = useUIStore(
    useShallow((s) => ({
      settingsOpen: s.settingsOpen,
      toggleSettings: s.toggleSettings,
    })),
  );
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
                aria-label={t("common.clear")}
                className="settings-search-clear"
                onClick={() => setSearchQuery("")}
                title={t("common.clear")}
              >
                <X size={12} />
              </button>
            )}
          </div>
          <button
            className="settings-close icon-btn"
            onClick={toggleSettings}
            title={t("common.close")}
          >
            <X size={16} />
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
                    <span className="settings-nav-icon">
                      <Puzzle {...TAB_ICON} />
                    </span>
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

// Settings Modal — 9-tab settings (General, Editor, Appearance, Markdown, AI, ActivityBar, Language, Keybindings, Plugins)
// Obsidian-style layout: label + description per row, section headers for grouping
import { useMemo, useState } from "react";

import type { Locale } from "../../i18n";

import { AVAILABLE_LOCALES, LOCALE_LABELS } from "../../i18n";
import { useTranslation } from "../../i18n/useTranslation";
import { useAIStore } from "../../stores/ai-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";
import { PluginMarketplace } from "../plugins/PluginMarketplace";
import { SettingsSectionHeader, ToggleSwitch } from "./settings-shared";
import { ActivityBarTab } from "./tabs/ActivityBarTab";
import { AITab } from "./tabs/AITab";
import { AppearanceTab } from "./tabs/AppearanceTab";
import { EditorTab } from "./tabs/EditorTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { KeybindingsTab } from "./tabs/KeybindingsTab";
import { LanguageTab } from "./tabs/LanguageTab";
import { MarkdownTab } from "./tabs/MarkdownTab";

type SettingsTab =
  | "activitybar"
  | "ai"
  | "appearance"
  | "editor"
  | "general"
  | "keybindings"
  | "language"
  | "markdown"
  | "plugins";

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

interface SearchableSetting {
  category: SettingsTab;
  description: string;
  id: string;
  keywords?: string[];
  label: string;
  section: string;
}

const SETTINGS_REGISTRY: SearchableSetting[] = [
  // General
  {
    id: "onLaunch",
    label: "settings.general.onLaunch",
    description: "settings.general.onLaunch.desc",
    category: "general",
    section: "settings.general.startup",
  },
  {
    id: "autoSave",
    label: "settings.general.autoSave",
    description: "settings.general.autoSave.desc",
    category: "general",
    section: "settings.general.saving",
  },
  {
    id: "autoSaveDelay",
    label: "settings.general.saveDelay",
    description: "settings.general.saveDelay.desc",
    category: "general",
    section: "settings.general.saving",
  },
  {
    id: "spellCheck",
    label: "settings.general.spellCheck",
    description: "settings.general.spellCheck.desc",
    category: "general",
    section: "settings.general.system",
  },
  {
    id: "wikilinkFormat",
    label: "settings.general.linkFormat",
    description: "settings.general.linkFormat.desc",
    category: "general",
    section: "settings.general.links",
    keywords: ["wikilink", "markdown", "link"],
  },
  {
    id: "autoUpdateLinks",
    label: "settings.general.autoUpdateLinks",
    description: "settings.general.autoUpdateLinks.desc",
    category: "general",
    section: "settings.general.links",
  },
  {
    id: "snapshotInterval",
    label: "settings.general.snapshotInterval",
    description: "settings.general.snapshotInterval.desc",
    category: "general",
    section: "settings.general.snapshots",
    keywords: ["version", "history", "backup"],
  },
  {
    id: "snapshotMaxCount",
    label: "settings.general.snapshotMaxCount",
    description: "settings.general.snapshotMaxCount.desc",
    category: "general",
    section: "settings.general.snapshots",
  },
  {
    id: "journalEnabled",
    label: "settings.general.journalEnabled",
    description: "settings.general.journalEnabled.desc",
    category: "general",
    section: "settings.general.journal",
    keywords: ["daily", "note", "diary"],
  },
  // Editor
  {
    id: "fontFamily",
    label: "settings.editor.fontFamily",
    description: "settings.editor.fontFamily.desc",
    category: "editor",
    section: "settings.editor.font",
    keywords: ["typeface", "font"],
  },
  {
    id: "fontSize",
    label: "settings.editor.fontSize",
    description: "settings.editor.fontSize.desc",
    category: "editor",
    section: "settings.editor.font",
  },
  {
    id: "lineHeight",
    label: "settings.editor.lineHeight",
    description: "settings.editor.lineHeight.desc",
    category: "editor",
    section: "settings.editor.font",
  },
  {
    id: "tabSize",
    label: "settings.editor.tabSize",
    description: "settings.editor.tabSize.desc",
    category: "editor",
    section: "settings.editor.behavior",
    keywords: ["indent", "space"],
  },
  {
    id: "autoPairBrackets",
    label: "settings.editor.autoPairBrackets",
    description: "settings.editor.autoPairBrackets.desc",
    category: "editor",
    section: "settings.editor.behavior",
  },
  {
    id: "lineNumbers",
    label: "settings.editor.lineNumbers",
    description: "settings.editor.lineNumbers.desc",
    category: "editor",
    section: "settings.editor.display",
  },
  {
    id: "editorMaxWidth",
    label: "settings.editor.maxWidth",
    description: "settings.editor.maxWidth.desc",
    category: "editor",
    section: "settings.editor.display",
  },
  // Appearance
  {
    id: "activeThemeId",
    label: "settings.appearance.theme",
    description: "settings.appearance.theme",
    category: "appearance",
    section: "settings.appearance.theme",
    keywords: ["dark", "light", "color", "theme"],
  },
  // Markdown
  {
    id: "inlineMath",
    label: "settings.markdown.inlineMath",
    description: "settings.markdown.inlineMath.desc",
    category: "markdown",
    section: "settings.markdown.extendedSyntax",
    keywords: ["katex", "latex", "equation"],
  },
  {
    id: "highlight",
    label: "settings.markdown.highlight",
    description: "settings.markdown.highlight.desc",
    category: "markdown",
    section: "settings.markdown.extendedSyntax",
  },
  {
    id: "strikethrough",
    label: "settings.markdown.strikethrough",
    description: "settings.markdown.strikethrough.desc",
    category: "markdown",
    section: "settings.markdown.extendedSyntax",
  },
  {
    id: "smartPunctuation",
    label: "settings.markdown.smartPunctuation",
    description: "settings.markdown.smartPunctuation.desc",
    category: "markdown",
    section: "settings.markdown.typography",
  },
  // AI
  {
    id: "provider",
    label: "settings.ai.aiProvider",
    description: "settings.ai.aiProvider.desc",
    category: "ai",
    section: "settings.ai.provider",
    keywords: ["claude", "openai", "ollama", "gemini"],
  },
  {
    id: "apiKey",
    label: "settings.ai.apiKey",
    description: "settings.ai.apiKey",
    category: "ai",
    section: "settings.ai.provider",
  },
  {
    id: "model",
    label: "settings.ai.model",
    description: "settings.ai.model.desc",
    category: "ai",
    section: "settings.ai.provider",
  },
  {
    id: "ghostTextEnabled",
    label: "settings.ai.ghostTextEnabled",
    description: "settings.ai.ghostTextEnabled.desc",
    category: "ai",
    section: "settings.ai.ghostText",
    keywords: ["autocomplete", "suggestion"],
  },
  {
    id: "privacyMode",
    label: "settings.ai.privacyMode",
    description: "settings.ai.privacyMode.desc",
    category: "ai",
    section: "settings.ai.privacy",
  },
  // Activity Bar
  {
    id: "activityBarConfig",
    label: "settings.tab.activitybar",
    description: "settings.activitybar.desc",
    category: "activitybar",
    section: "settings.tab.activitybar",
    keywords: ["icon", "sidebar", "panel"],
  },
  // Language
  {
    id: "locale",
    label: "settings.language.title",
    description: "settings.language.interface.desc",
    category: "language",
    section: "settings.language.title",
    keywords: ["locale", "i18n", "korean", "english", "\uD55C\uAD6D\uC5B4"],
  },
  // Keybindings
  {
    id: "keybindings",
    label: "settings.tab.keybindings",
    description: "",
    category: "keybindings",
    section: "settings.tab.keybindings",
    keywords: [
      "shortcut",
      "key",
      "binding",
      "hotkey",
      "keyboard",
      "remap",
      "\uB2E8\uCD95\uD0A4",
      "\uD0A4\uBCF4\uB4DC",
      "\uBC14\uC778\uB529",
    ],
  },
];

export function SettingsModal() {
  const { settingsOpen, toggleSettings } = useUIStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [searchQuery, setSearchQuery] = useState("");
  const { t } = useTranslation();

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return SETTINGS_REGISTRY.filter(
      (s) =>
        t(s.label).toLowerCase().includes(q) ||
        t(s.description).toLowerCase().includes(q) ||
        t(s.section).toLowerCase().includes(q) ||
        (s.keywords ?? []).some((k) => k.includes(q)),
    );
  }, [searchQuery, t]);

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

// ─── Search Results ─────────────────────────────────────

/** Renders the actual control for a setting in search results. */
function SearchSettingControl({
  id,
  onNavigate,
}: {
  id: string;
  onNavigate: () => void;
}) {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const ai = useAIStore();

  switch (id) {
    // ── Complex settings: navigate to tab ──
    case "activeThemeId":
    case "activityBarConfig":
    case "apiKey":
    case "fontFamily":
    // falls through
    case "model":
      return (
        <button className="theme-action-btn" onClick={onNavigate}>
          {t("settings.search.open")}
        </button>
      );
    case "autoPairBrackets":
      return (
        <ToggleSwitch
          checked={settings.autoPairBrackets}
          onChange={settings.setAutoPairBrackets}
        />
      );

    // ── General toggles ──
    case "autoSave":
      return (
        <ToggleSwitch
          checked={settings.autoSave}
          onChange={settings.setAutoSave}
        />
      );
    // ── General ranges ──
    case "autoSaveDelay":
      return (
        <input
          className="settings-range"
          max={10000}
          min={500}
          onChange={(e) => settings.setAutoSaveDelay(Number(e.target.value))}
          step={500}
          type="range"
          value={settings.autoSaveDelay}
        />
      );
    case "autoUpdateLinks":
      return (
        <ToggleSwitch
          checked={settings.autoUpdateLinks}
          onChange={settings.setAutoUpdateLinks}
        />
      );

    case "editorMaxWidth":
      return (
        <input
          className="settings-range"
          max={2048}
          min={0}
          onChange={(e) => settings.setEditorMaxWidth(Number(e.target.value))}
          step={50}
          type="range"
          value={settings.editorMaxWidth}
        />
      );
    // ── Editor ranges ──
    case "fontSize":
      return (
        <input
          className="settings-range"
          max={32}
          min={8}
          onChange={(e) => settings.setFontSize(Number(e.target.value))}
          step={1}
          type="range"
          value={settings.fontSize}
        />
      );
    // ── AI toggles ──
    case "ghostTextEnabled":
      return (
        <ToggleSwitch
          checked={ai.ghostTextEnabled}
          onChange={ai.setGhostTextEnabled}
        />
      );

    case "highlight":
      return (
        <ToggleSwitch
          checked={settings.highlight}
          onChange={settings.setHighlight}
        />
      );
    // ── Markdown toggles ──
    case "inlineMath":
      return (
        <ToggleSwitch
          checked={settings.inlineMath}
          onChange={settings.setInlineMath}
        />
      );

    case "journalEnabled":
      return (
        <ToggleSwitch
          checked={settings.journalEnabled}
          onChange={settings.setJournalEnabled}
        />
      );

    case "keybindings":
      return (
        <button className="settings-btn" onClick={onNavigate}>
          {t("settings.search.open")}
        </button>
      );
    case "lineHeight":
      return (
        <input
          className="settings-range"
          max={3.0}
          min={1.0}
          onChange={(e) => settings.setLineHeight(Number(e.target.value))}
          step={0.05}
          type="range"
          value={settings.lineHeight}
        />
      );
    // ── Editor toggles ──
    case "lineNumbers":
      return (
        <ToggleSwitch
          checked={settings.lineNumbers}
          onChange={settings.setLineNumbers}
        />
      );
    // ── Language ──
    case "locale":
      return (
        <select
          className="settings-select"
          onChange={(e) => settings.setLocale(e.target.value)}
          value={settings.locale}
        >
          {AVAILABLE_LOCALES.map((loc: Locale) => (
            <option key={loc} value={loc}>
              {LOCALE_LABELS[loc]}
            </option>
          ))}
        </select>
      );

    // ── General selects ──
    case "onLaunch":
      return (
        <select
          className="settings-select"
          onChange={(e) =>
            settings.setOnLaunch(
              e.target.value as
                | "newFile"
                | "restoreLastFile"
                | "restoreLastFolder",
            )
          }
          value={settings.onLaunch}
        >
          <option value="restoreLastFolder">
            {t("settings.general.onLaunch.restoreLastFolder")}
          </option>
          <option value="restoreLastFile">
            {t("settings.general.onLaunch.restoreLastFile")}
          </option>
          <option value="newFile">
            {t("settings.general.onLaunch.newFile")}
          </option>
        </select>
      );
    case "privacyMode":
      return (
        <ToggleSwitch checked={ai.privacyMode} onChange={ai.setPrivacyMode} />
      );

    // ── AI selects ──
    case "provider":
      return (
        <select
          className="settings-select"
          onChange={(e) =>
            ai.setProvider(
              e.target.value as "claude" | "gemini" | "ollama" | "openai",
            )
          }
          value={ai.provider}
        >
          <option value="claude">{t("settings.ai.provider.claude")}</option>
          <option value="openai">{t("settings.ai.provider.openai")}</option>
          <option value="gemini">{t("settings.ai.provider.gemini")}</option>
          <option value="ollama">{t("settings.ai.provider.ollama")}</option>
        </select>
      );

    case "smartPunctuation":
      return (
        <ToggleSwitch
          checked={settings.smartPunctuation}
          onChange={settings.setSmartPunctuation}
        />
      );

    case "snapshotInterval":
      return (
        <input
          className="settings-range"
          max={120}
          min={0}
          onChange={(e) => settings.setSnapshotInterval(Number(e.target.value))}
          step={5}
          type="range"
          value={settings.snapshotInterval}
        />
      );
    case "snapshotMaxCount":
      return (
        <input
          className="settings-range"
          max={200}
          min={5}
          onChange={(e) => settings.setSnapshotMaxCount(Number(e.target.value))}
          step={5}
          type="range"
          value={settings.snapshotMaxCount}
        />
      );
    case "spellCheck":
      return (
        <ToggleSwitch
          checked={settings.spellCheck}
          onChange={settings.setSpellCheck}
        />
      );
    case "strikethrough":
      return (
        <ToggleSwitch
          checked={settings.strikethrough}
          onChange={settings.setStrikethrough}
        />
      );
    // ── Editor selects ──
    case "tabSize":
      return (
        <select
          className="settings-select"
          onChange={(e) => settings.setTabSize(Number(e.target.value))}
          value={settings.tabSize}
        >
          <option value={2}>{t("settings.editor.tabSize.2spaces")}</option>
          <option value={4}>{t("settings.editor.tabSize.4spaces")}</option>
        </select>
      );
    case "wikilinkFormat":
      return (
        <select
          className="settings-select"
          onChange={(e) =>
            settings.setWikilinkFormat(
              e.target.value as "markdown" | "wikilink",
            )
          }
          value={settings.wikilinkFormat}
        >
          <option value="wikilink">{"[[Wikilink]]"}</option>
          <option value="markdown">[Markdown](link)</option>
        </select>
      );

    default:
      return null;
  }
}

function SettingsSearchResults({
  grouped,
  query,
  onNavigate,
}: {
  grouped: Map<SettingsTab, SearchableSetting[]> | null;
  onNavigate: (tab: SettingsTab) => void;
  query: string;
}) {
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
                  id={item.id}
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

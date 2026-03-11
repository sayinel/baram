// Settings Modal — 9-tab settings (General, Editor, Appearance, Markdown, AI, ActivityBar, Language, Keybindings, Plugins)
// Obsidian-style layout: label + description per row, section headers for grouping
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { Locale } from "../../i18n";
import type { ModelInfo } from "../../ipc/types";
import type { ActivityBarItemConfig } from "../../stores/settings-store";
import type { WorkspacePreset } from "../../stores/workspace-store";
import type { ThemeDef } from "../../types/theme";

import registry from "../../extensions/registry.json";
import { AVAILABLE_LOCALES, LOCALE_LABELS } from "../../i18n";
import { useTranslation } from "../../i18n/useTranslation";
import { llmListModels } from "../../ipc/invoke";
import { readFile } from "../../ipc/invoke";
import {
  formatKeyForDisplay,
  normalizeKeyEvent,
} from "../../keybindings/key-utils";
import {
  CATEGORY_LABELS,
  KEYBINDING_CATEGORIES,
} from "../../keybindings/keybinding-registry";
import {
  findConflict,
  getMergedKeybindings,
  type MergedKeybinding,
} from "../../keybindings/use-keybindings";
import { type AIProvider, useAIStore } from "../../stores/ai-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useUIStore } from "../../stores/ui-store";
import {
  BUILTIN_PRESETS,
  useWorkspaceStore,
} from "../../stores/workspace-store";
import { BUILT_IN_THEMES } from "../../types/theme";
import { THEME_COLOR_KEYS } from "../../types/theme";
import { formatAIError } from "../../utils/format-error";
import { initJournalTemplatesDir } from "../../utils/journal-templates";
import {
  MigrationDialog,
  type MigrationDirection,
} from "../journal/MigrationDialog";
import { PluginMarketplace } from "../plugins/PluginMarketplace";
import { CustomAICommandEditor } from "./CustomAICommandEditor";
import { ThemeEditor } from "./ThemeEditor";

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
      "단축키",
      "키보드",
      "바인딩",
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

// ─── General Tab ────────────────────────────────────────

function AppearanceTab() {
  const { t } = useTranslation();
  const {
    activeThemeId,
    customThemes,
    setActiveTheme,
    saveCustomTheme,
    deleteCustomTheme,
  } = useSettingsStore();
  const [editingTheme, setEditingTheme] = useState(false);

  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  const handleImport = useCallback(async () => {
    const selected = await open({
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!selected) return;
    try {
      const content = await readFile(selected);
      const data = JSON.parse(content);
      // Validate required fields
      if (typeof data.name !== "string" || !data.name) {
        throw new Error("Missing or invalid 'name' field");
      }
      if (data.base !== "light" && data.base !== "dark") {
        throw new Error("'base' must be 'light' or 'dark'");
      }
      if (!data.colors || typeof data.colors !== "object") {
        throw new Error("Missing or invalid 'colors' object");
      }
      // Validate all 16 color keys are present
      const requiredKeys = THEME_COLOR_KEYS.map((k) => k.key);
      for (const key of requiredKeys) {
        if (typeof data.colors[key] !== "string") {
          throw new Error(`Missing color key: ${key}`);
        }
      }
      const newTheme: ThemeDef = {
        id: "custom-" + Date.now(),
        name: data.name,
        base: data.base,
        colors: data.colors,
        builtIn: false,
      };
      saveCustomTheme(newTheme);
      setActiveTheme(newTheme.id);
    } catch (err) {
      console.error("Theme import failed:", err);
    }
  }, [saveCustomTheme, setActiveTheme]);

  if (editingTheme) {
    return <ThemeEditor onClose={() => setEditingTheme(false)} />;
  }

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.appearance.theme")} />

      <div className="theme-gallery">
        {/* System (Auto) card */}
        <button
          className={`theme-card theme-system-card ${activeThemeId === "system" ? "theme-card-active" : ""}`}
          onClick={() => setActiveTheme("system")}
        >
          <div className="theme-preview theme-preview-split">
            <div
              className="theme-preview-half"
              style={{ background: "#ffffff" }}
            >
              <div
                className="theme-preview-sidebar"
                style={{
                  background: "#f5f5f5",
                  borderRight: "1px solid #e5e5e5",
                }}
              >
                <div
                  className="theme-preview-sidebar-item"
                  style={{ background: "#e0e0e0" }}
                />
                <div
                  className="theme-preview-sidebar-item"
                  style={{ background: "#e0e0e0" }}
                />
              </div>
              <div
                className="theme-preview-editor"
                style={{ background: "#ffffff" }}
              >
                <div
                  className="theme-preview-heading"
                  style={{ color: "#1a1a1a", fontSize: 7 }}
                >
                  Aa
                </div>
              </div>
            </div>
            <div
              className="theme-preview-half"
              style={{ background: "#1a1a2e" }}
            >
              <div
                className="theme-preview-sidebar"
                style={{
                  background: "#16213e",
                  borderRight: "1px solid #2a2a4a",
                }}
              >
                <div
                  className="theme-preview-sidebar-item"
                  style={{ background: "#2a2a4a" }}
                />
                <div
                  className="theme-preview-sidebar-item"
                  style={{ background: "#2a2a4a" }}
                />
              </div>
              <div
                className="theme-preview-editor"
                style={{ background: "#1a1a2e" }}
              >
                <div
                  className="theme-preview-heading"
                  style={{ color: "#e2e8f0", fontSize: 7 }}
                >
                  Aa
                </div>
              </div>
            </div>
          </div>
          <span className="theme-card-name">
            {t("settings.appearance.systemAuto")}
          </span>
        </button>

        {/* All themes */}
        {allThemes.map((theme) => (
          <button
            className={`theme-card ${activeThemeId === theme.id ? "theme-card-active" : ""}`}
            key={theme.id}
            onClick={() => setActiveTheme(theme.id)}
            style={
              activeThemeId === theme.id
                ? { borderColor: theme.colors["--color-accent"] }
                : undefined
            }
          >
            <ThemeMiniPreview theme={theme} />
            <span className="theme-card-name">{theme.name}</span>
            {!theme.builtIn && (
              <span className="theme-card-badge">
                {t("settings.appearance.customBadge")}
              </span>
            )}
            {!theme.builtIn && (
              <button
                className="theme-card-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteCustomTheme(theme.id);
                }}
                title={t("settings.appearance.deleteTheme")}
              >
                {"\u00D7"}
              </button>
            )}
          </button>
        ))}
      </div>

      <div className="theme-actions">
        <button
          className="theme-action-btn"
          onClick={() => setEditingTheme(true)}
        >
          {t("settings.appearance.customize")}
        </button>
        <button className="theme-action-btn" onClick={handleImport}>
          {t("settings.appearance.import")}
        </button>
      </div>

      <SettingsSectionHeader
        title={t("settings.appearance.workspacePresets")}
      />
      <WorkspaceSection />
    </div>
  );
}

// ─── Editor Tab ─────────────────────────────────────────

function EditorTab() {
  const { t } = useTranslation();
  const {
    fontFamily,
    setFontFamily,
    fontSize,
    setFontSize,
    lineHeight,
    setLineHeight,
    tabSize,
    setTabSize,
    lineNumbers,
    setLineNumbers,
    autoPairBrackets,
    setAutoPairBrackets,
    editorMaxWidth,
    setEditorMaxWidth,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.editor.font")} />

      <SettingsRow
        description={t("settings.editor.fontFamily.desc")}
        label={t("settings.editor.fontFamily")}
      >
        <FontFamilyPicker onChange={setFontFamily} value={fontFamily} />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.fontSize.desc").replace(
          "{value}",
          String(fontSize),
        )}
        label={t("settings.editor.fontSize")}
      >
        <input
          className="settings-range"
          max={32}
          min={8}
          onChange={(e) => setFontSize(Number(e.target.value))}
          step={1}
          type="range"
          value={fontSize}
        />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.lineHeight.desc").replace(
          "{value}",
          lineHeight.toFixed(2),
        )}
        label={t("settings.editor.lineHeight")}
      >
        <input
          className="settings-range"
          max={3.0}
          min={1.0}
          onChange={(e) => setLineHeight(Number(e.target.value))}
          step={0.05}
          type="range"
          value={lineHeight}
        />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.editor.behavior")} />

      <SettingsRow
        description={t("settings.editor.tabSize.desc")}
        label={t("settings.editor.tabSize")}
      >
        <select
          className="settings-select"
          onChange={(e) => setTabSize(Number(e.target.value))}
          value={tabSize}
        >
          <option value={2}>{t("settings.editor.tabSize.2spaces")}</option>
          <option value={4}>{t("settings.editor.tabSize.4spaces")}</option>
        </select>
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.autoPairBrackets.desc")}
        label={t("settings.editor.autoPairBrackets")}
      >
        <ToggleSwitch
          checked={autoPairBrackets}
          onChange={setAutoPairBrackets}
        />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.editor.display")} />

      <SettingsRow
        description={t("settings.editor.lineNumbers.desc")}
        label={t("settings.editor.lineNumbers")}
      >
        <ToggleSwitch checked={lineNumbers} onChange={setLineNumbers} />
      </SettingsRow>

      <SettingsRow
        description={t("settings.editor.maxWidth.desc").replace(
          "{value}",
          editorMaxWidth === 0
            ? t("settings.editor.maxWidth.noLimit")
            : editorMaxWidth + "px",
        )}
        label={t("settings.editor.maxWidth")}
      >
        <input
          className="settings-range"
          max={2048}
          min={0}
          onChange={(e) => setEditorMaxWidth(Number(e.target.value))}
          step={50}
          type="range"
          value={editorMaxWidth}
        />
      </SettingsRow>
    </div>
  );
}

// ─── Appearance Tab ─────────────────────────────────────

function GeneralTab() {
  const { t } = useTranslation();
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationDirection, setMigrationDirection] =
    useState<MigrationDirection>("toHierarchy");
  const [templatesInitMsg, setTemplatesInitMsg] = useState<null | string>(null);
  const {
    onLaunch,
    setOnLaunch,
    autoSave,
    setAutoSave,
    autoSaveDelay,
    setAutoSaveDelay,
    spellCheck,
    setSpellCheck,
    wikilinkFormat,
    setWikilinkFormat,
    autoUpdateLinks,
    setAutoUpdateLinks,
    snapshotInterval,
    setSnapshotInterval,
    snapshotMaxCount,
    setSnapshotMaxCount,
    journalEnabled,
    setJournalEnabled,
    journalDirectory,
    setJournalDirectory,
    journalFilenameFormat,
    setJournalFilenameFormat,
    journalTemplatePath,
    setJournalTemplatePath,
    journalStartupBehavior,
    setJournalStartupBehavior,
    journalUseHierarchy,
    setJournalUseHierarchy,
    journalWeeklyTemplate,
    setJournalWeeklyTemplate,
    journalMonthlyTemplate,
    setJournalMonthlyTemplate,
    journalYearlyTemplate,
    setJournalYearlyTemplate,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.general.startup")} />

      <SettingsRow
        description={t("settings.general.onLaunch.desc")}
        label={t("settings.general.onLaunch")}
      >
        <select
          className="settings-select"
          onChange={(e) =>
            setOnLaunch(
              e.target.value as
                | "newFile"
                | "restoreLastFile"
                | "restoreLastFolder",
            )
          }
          value={onLaunch}
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
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.saving")} />

      <SettingsRow
        description={t("settings.general.autoSave.desc")}
        label={t("settings.general.autoSave")}
      >
        <ToggleSwitch checked={autoSave} onChange={setAutoSave} />
      </SettingsRow>

      {autoSave && (
        <SettingsRow
          description={t("settings.general.saveDelay.desc").replace(
            "{value}",
            (autoSaveDelay / 1000).toFixed(1),
          )}
          label={t("settings.general.saveDelay")}
        >
          <input
            className="settings-range"
            max={10000}
            min={500}
            onChange={(e) => setAutoSaveDelay(Number(e.target.value))}
            step={500}
            type="range"
            value={autoSaveDelay}
          />
        </SettingsRow>
      )}

      <SettingsSectionHeader title={t("settings.general.system")} />

      <SettingsRow
        description={t("settings.general.spellCheck.desc")}
        label={t("settings.general.spellCheck")}
      >
        <ToggleSwitch checked={spellCheck} onChange={setSpellCheck} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.links")} />

      <SettingsRow
        description={t("settings.general.linkFormat.desc")}
        label={t("settings.general.linkFormat")}
      >
        <select
          className="settings-select"
          onChange={(e) =>
            setWikilinkFormat(e.target.value as "markdown" | "wikilink")
          }
          value={wikilinkFormat}
        >
          <option value="wikilink">[[Wikilink]]</option>
          <option value="markdown">[Markdown](link)</option>
        </select>
      </SettingsRow>

      <SettingsRow
        description={t("settings.general.autoUpdateLinks.desc")}
        label={t("settings.general.autoUpdateLinks")}
      >
        <ToggleSwitch checked={autoUpdateLinks} onChange={setAutoUpdateLinks} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.snapshots")} />

      <SettingsRow
        description={t("settings.general.snapshotInterval.desc").replace(
          "{value}",
          String(snapshotInterval),
        )}
        label={t("settings.general.snapshotInterval")}
      >
        <input
          className="settings-range"
          max={120}
          min={0}
          onChange={(e) => setSnapshotInterval(Number(e.target.value))}
          step={5}
          type="range"
          value={snapshotInterval}
        />
      </SettingsRow>

      <SettingsRow
        description={t("settings.general.snapshotMaxCount.desc").replace(
          "{value}",
          String(snapshotMaxCount),
        )}
        label={t("settings.general.snapshotMaxCount")}
      >
        <input
          className="settings-range"
          max={200}
          min={5}
          onChange={(e) => setSnapshotMaxCount(Number(e.target.value))}
          step={5}
          type="range"
          value={snapshotMaxCount}
        />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.journal")} />

      <SettingsRow
        description={t("settings.general.journalEnabled.desc")}
        label={t("settings.general.journalEnabled")}
      >
        <ToggleSwitch checked={journalEnabled} onChange={setJournalEnabled} />
      </SettingsRow>

      {journalEnabled && (
        <>
          <SettingsRow
            description={t("settings.general.journalDirectory.desc")}
            label={t("settings.general.journalDirectory")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalDirectory.placeholder")}
                readOnly
                type="text"
                value={journalDirectory}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({ directory: true });
                  if (selected) setJournalDirectory(selected);
                }}
              >
                {t("common.browse")}
              </button>
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.journalFilenameFormat.desc")}
            label={t("settings.general.journalFilenameFormat")}
          >
            <select
              className="settings-select"
              onChange={(e) => setJournalFilenameFormat(e.target.value)}
              value={journalFilenameFormat}
            >
              <option value="YYYY-MM-DD.md">YYYY-MM-DD.md</option>
              <option value="YYYYMMDD.md">YYYYMMDD.md</option>
            </select>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.journalTemplate.desc")}
            label={t("settings.general.journalTemplate")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalTemplate.placeholder")}
                readOnly
                type="text"
                value={journalTemplatePath}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({
                    filters: [{ name: "Markdown", extensions: ["md"] }],
                  });
                  if (selected) setJournalTemplatePath(selected);
                }}
              >
                {t("common.browse")}
              </button>
              {journalTemplatePath && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalTemplatePath("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.journalStartup.desc")}
            label={t("settings.general.journalStartup")}
          >
            <select
              className="settings-select"
              onChange={(e) =>
                setJournalStartupBehavior(
                  e.target.value as "nothing" | "openJournal",
                )
              }
              value={journalStartupBehavior}
            >
              <option value="openJournal">
                {t("settings.general.journalStartup.openJournal")}
              </option>
              <option value="nothing">
                {t("settings.general.journalStartup.nothing")}
              </option>
            </select>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.journalHierarchy.desc")}
            label={t("settings.general.journalHierarchy")}
          >
            <ToggleSwitch
              checked={journalUseHierarchy}
              onChange={setJournalUseHierarchy}
            />
          </SettingsRow>

          {journalDirectory && (
            <SettingsRow
              description={
                journalUseHierarchy
                  ? t("settings.general.journalMigrate.desc")
                  : t("settings.general.journalFlatten.desc")
              }
              label={
                journalUseHierarchy
                  ? t("settings.general.journalMigrate")
                  : t("settings.general.journalFlatten")
              }
            >
              <button
                className="settings-key-toggle"
                onClick={() => {
                  setMigrationDirection(
                    journalUseHierarchy ? "toHierarchy" : "toFlat",
                  );
                  setMigrationOpen(true);
                }}
              >
                {journalUseHierarchy
                  ? t("settings.general.journalMigrate.button")
                  : t("settings.general.journalFlatten.button")}
              </button>
            </SettingsRow>
          )}

          <SettingsSectionHeader
            title={t("settings.general.periodicTemplates")}
          />

          <SettingsRow
            description={t("settings.general.weeklyTemplate.desc")}
            label={t("settings.general.weeklyTemplate")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalTemplate.placeholder")}
                readOnly
                type="text"
                value={journalWeeklyTemplate}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({
                    filters: [{ name: "Markdown", extensions: ["md"] }],
                  });
                  if (selected) setJournalWeeklyTemplate(selected);
                }}
              >
                {t("common.browse")}
              </button>
              {journalWeeklyTemplate && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalWeeklyTemplate("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.monthlyTemplate.desc")}
            label={t("settings.general.monthlyTemplate")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalTemplate.placeholder")}
                readOnly
                type="text"
                value={journalMonthlyTemplate}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({
                    filters: [{ name: "Markdown", extensions: ["md"] }],
                  });
                  if (selected) setJournalMonthlyTemplate(selected);
                }}
              >
                {t("common.browse")}
              </button>
              {journalMonthlyTemplate && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalMonthlyTemplate("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow
            description={t("settings.general.yearlyTemplate.desc")}
            label={t("settings.general.yearlyTemplate")}
          >
            <div className="settings-key-row">
              <input
                className="settings-input settings-input-key"
                placeholder={t("settings.general.journalTemplate.placeholder")}
                readOnly
                type="text"
                value={journalYearlyTemplate}
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({
                    filters: [{ name: "Markdown", extensions: ["md"] }],
                  });
                  if (selected) setJournalYearlyTemplate(selected);
                }}
              >
                {t("common.browse")}
              </button>
              {journalYearlyTemplate && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalYearlyTemplate("")}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </SettingsRow>

          {journalDirectory && (
            <SettingsRow
              description={t("settings.general.createTemplateFiles.desc")}
              label={t("settings.general.createTemplateFiles")}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 4,
                }}
              >
                <button
                  className="settings-key-toggle"
                  onClick={async () => {
                    try {
                      await initJournalTemplatesDir(journalDirectory);
                      setTemplatesInitMsg(
                        t("settings.general.createTemplateFiles.success"),
                      );
                    } catch {
                      setTemplatesInitMsg(
                        t("settings.general.createTemplateFiles.error"),
                      );
                    }
                    setTimeout(() => setTemplatesInitMsg(null), 3000);
                  }}
                >
                  {t("settings.general.createTemplateFiles.button")}
                </button>
                {templatesInitMsg && (
                  <span className="settings-row-description">
                    {templatesInitMsg}
                  </span>
                )}
              </div>
            </SettingsRow>
          )}

          <SettingsSectionHeader title={t("settings.general.journalAI")} />

          <SettingsRow
            description={t("settings.general.journalAIAutoSuggest.desc")}
            label={t("settings.general.journalAIAutoSuggest")}
          >
            <ToggleSwitch
              checked={useSettingsStore.getState().journalAIAutoSuggest}
              onChange={(v) =>
                useSettingsStore.getState().setJournalAIAutoSuggest(v)
              }
            />
          </SettingsRow>
        </>
      )}

      <MigrationDialog
        direction={migrationDirection}
        journalDir={journalDirectory}
        onClose={() => setMigrationOpen(false)}
        open={migrationOpen}
      />
    </div>
  );
}

// ─── Workspace Section (merged from WorkspaceTab) ────────

function LayoutDiagram({ preset }: { preset: WorkspacePreset }) {
  const { layout } = preset;
  return (
    <div className="workspace-diagram">
      {layout.sidebarOpen && (
        <div className="workspace-diagram-panel workspace-diagram-sidebar" />
      )}
      <div className="workspace-diagram-panel workspace-diagram-editor" />
      {layout.rightPanelOpen && layout.rightPanelMode !== "none" && (
        <div className="workspace-diagram-panel workspace-diagram-right" />
      )}
    </div>
  );
}

function MarkdownTab() {
  const { t } = useTranslation();
  const {
    inlineMath,
    setInlineMath,
    highlight,
    setHighlight,
    strikethrough,
    setStrikethrough,
    smartPunctuation,
    setSmartPunctuation,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.markdown.extendedSyntax")} />

      <SettingsRow
        description={t("settings.markdown.inlineMath.desc")}
        label={t("settings.markdown.inlineMath")}
      >
        <ToggleSwitch checked={inlineMath} onChange={setInlineMath} />
      </SettingsRow>

      <SettingsRow
        description={t("settings.markdown.highlight.desc")}
        label={t("settings.markdown.highlight")}
      >
        <ToggleSwitch checked={highlight} onChange={setHighlight} />
      </SettingsRow>

      <SettingsRow
        description={t("settings.markdown.strikethrough.desc")}
        label={t("settings.markdown.strikethrough")}
      >
        <ToggleSwitch checked={strikethrough} onChange={setStrikethrough} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.markdown.typography")} />

      <SettingsRow
        description={t("settings.markdown.smartPunctuation.desc")}
        label={t("settings.markdown.smartPunctuation")}
      >
        <ToggleSwitch
          checked={smartPunctuation}
          onChange={setSmartPunctuation}
        />
      </SettingsRow>

      {/* Extension Settings (merged from ExtensionsTab) */}
      {getExtensionsWithSettings().map((ext) => (
        <div key={ext.name}>
          <SettingsSectionHeader title={formatExtName(ext.name)} />
          {ext.settings.map((s) => (
            <ExtensionSettingRow key={s.key} setting={s} />
          ))}
        </div>
      ))}
    </div>
  );
}

function PresetCard({
  preset,
  isActive,
  onApply,
  onDelete,
}: {
  isActive: boolean;
  onApply: (id: string) => void;
  onDelete?: (id: string) => void;
  preset: WorkspacePreset;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`workspace-card ${isActive ? "workspace-card-active" : ""}`}
      onClick={() => onApply(preset.id)}
    >
      {isActive && (
        <span aria-label="Active" className="workspace-card-check">
          &#10003;
        </span>
      )}
      {onDelete && (
        <button
          className="workspace-card-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(preset.id);
          }}
          title={t("settings.workspace.deletePreset")}
        >
          {"\u00D7"}
        </button>
      )}

      <div className="workspace-card-layout">
        <LayoutDiagram preset={preset} />
      </div>

      <span className="workspace-card-name">
        {preset.builtIn
          ? t(`settings.workspace.preset.${preset.id}`)
          : preset.name}
      </span>
      {preset.description && (
        <span className="workspace-card-desc">
          {preset.builtIn
            ? t(`settings.workspace.preset.${preset.id}.desc`)
            : preset.description}
        </span>
      )}
      <span className="workspace-card-summary">
        {workspaceLayoutSummary(preset, t)}
      </span>

      {preset.builtIn && (
        <span className="workspace-card-badge">
          {t("settings.workspace.builtIn")}
        </span>
      )}
    </div>
  );
}

function workspaceLayoutSummary(
  preset: WorkspacePreset,
  t: (key: string) => string,
): string {
  const panelKey = `settings.panels.${preset.layout.sidebarPanel}`;
  const parts: string[] = [];
  if (preset.layout.sidebarOpen) {
    parts.push(t(panelKey));
  }
  parts.push(t("settings.workspace.editor"));
  if (preset.layout.rightPanelOpen && preset.layout.rightPanelMode !== "none") {
    parts.push(t(`settings.panels.${preset.layout.rightPanelMode}`));
  }
  return parts.join(" + ");
}

// ─── Markdown Tab ───────────────────────────────────────

function WorkspaceSection() {
  const { t } = useTranslation();
  const {
    activePresetId,
    customPresets,
    applyPreset,
    saveCustomPreset,
    deleteCustomPreset,
  } = useWorkspaceStore();

  const [savingNew, setSavingNew] = useState(false);
  const [newName, setNewName] = useState("");

  const allPresets = [...BUILTIN_PRESETS, ...customPresets];

  const handleApply = useCallback(
    (id: string) => {
      applyPreset(id);
    },
    [applyPreset],
  );

  const handleSave = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    saveCustomPreset(trimmed);
    setNewName("");
    setSavingNew(false);
  }, [newName, saveCustomPreset]);

  const handleSaveKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSave();
      } else if (e.key === "Escape") {
        setNewName("");
        setSavingNew(false);
      }
    },
    [handleSave],
  );

  return (
    <>
      <div className="workspace-gallery">
        {allPresets.map((preset) => (
          <PresetCard
            isActive={activePresetId === preset.id}
            key={preset.id}
            onApply={handleApply}
            onDelete={!preset.builtIn ? deleteCustomPreset : undefined}
            preset={preset}
          />
        ))}
      </div>

      <div className="workspace-actions">
        {savingNew ? (
          <div className="workspace-save-form">
            <input
              autoFocus
              className="workspace-save-input"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleSaveKeyDown}
              placeholder={t("settings.workspace.presetName")}
              type="text"
              value={newName}
            />
            <button
              className="workspace-save-confirm"
              disabled={!newName.trim()}
              onClick={handleSave}
            >
              {t("common.save")}
            </button>
            <button
              className="workspace-save-cancel"
              onClick={() => {
                setNewName("");
                setSavingNew(false);
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <button
            className="workspace-action-btn"
            onClick={() => setSavingNew(true)}
          >
            {t("settings.appearance.saveCurrentLayout")}
          </button>
        )}
      </div>
    </>
  );
}

// ─── Task Model Selector ────────────────────────────────
// Provider + Model dropdowns for per-task auto model selection

const PROVIDER_LABELS: Record<AIProvider, string> = {
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama",
};

function AITab() {
  const { t } = useTranslation();
  const {
    provider,
    setProvider,
    model,
    setModel,
    apiKey,
    setApiKey,
    ollamaUrl,
    setOllamaUrl,
    privacyMode,
    setPrivacyMode,
    ghostTextEnabled,
    setGhostTextEnabled,
    ghostTextDebounceMs,
    setGhostTextDebounceMs,
    maxSuggestionLength,
    setMaxSuggestionLength,
    keychainReady,
    autoModelEnabled,
    setAutoModelEnabled,
    modelForGhostText,
    modelForInlineEdit,
    modelForChat,
    modelForAgent,
    setModelForTask,
    apiKeys,
    providerForGhostText,
    providerForInlineEdit,
    providerForChat,
    providerForAgent,
    setProviderForTask,
  } = useAIStore();
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<null | string>(null);
  const [customMode, setCustomMode] = useState(false);

  // Model cache for task-specific selectors (avoids redundant API calls)
  const modelCacheRef = useRef<Record<string, ModelInfo[]>>({});

  const fetchModelsForProvider = useCallback(
    async (prov: AIProvider): Promise<ModelInfo[]> => {
      if (modelCacheRef.current[prov]) return modelCacheRef.current[prov];
      try {
        const keys = useAIStore.getState().apiKeys;
        const key = prov === "ollama" ? undefined : keys[prov];
        const baseUrl = prov === "ollama" ? ollamaUrl || undefined : undefined;
        const result = await llmListModels(prov, key, baseUrl);
        modelCacheRef.current[prov] = result;
        return result;
      } catch {
        return [];
      }
    },
    [ollamaUrl],
  );

  const configuredProviders = useMemo((): AIProvider[] => {
    const result: AIProvider[] = [];
    if (apiKeys.claude) result.push("claude");
    if (apiKeys.openai) result.push("openai");
    if (apiKeys.gemini) result.push("gemini");
    result.push("ollama");
    return result;
  }, [apiKeys]);

  const handleProviderChange = useCallback(
    (newProvider: "claude" | "gemini" | "ollama" | "openai") => {
      setProvider(newProvider);
      if (newProvider === "claude") setModel("claude-sonnet-4-5-20250929");
      else if (newProvider === "openai") setModel("gpt-4o");
      else if (newProvider === "ollama") setModel("llama3");
      else if (newProvider === "gemini") setModel("gemini-2.0-flash");
      setModels([]);
      setModelsError(null);
      setCustomMode(false);
    },
    [setProvider, setModel],
  );

  const fetchModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const baseUrl =
        provider === "ollama" ? ollamaUrl || undefined : undefined;
      const key = provider === "ollama" ? undefined : apiKey;
      const result = await llmListModels(provider, key, baseUrl);
      setModels(result);
      setCustomMode(false);
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err));
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [provider, apiKey, ollamaUrl]);

  const canFetchModels = provider === "ollama" || apiKey.length > 0;
  const showApiKey = provider !== "ollama";

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.ai.provider")} />

      <SettingsRow
        description={t("settings.ai.aiProvider.desc")}
        label={t("settings.ai.aiProvider")}
      >
        <select
          className="settings-select"
          onChange={(e) =>
            handleProviderChange(
              e.target.value as "claude" | "gemini" | "ollama" | "openai",
            )
          }
          value={provider}
        >
          <option value="claude">{t("settings.ai.provider.claude")}</option>
          <option value="openai">{t("settings.ai.provider.openai")}</option>
          <option value="gemini">{t("settings.ai.provider.gemini")}</option>
          <option value="ollama">{t("settings.ai.provider.ollama")}</option>
        </select>
      </SettingsRow>

      {showApiKey && (
        <SettingsRow
          description={
            keychainReady
              ? t("settings.ai.apiKey.desc.ready")
              : t("settings.ai.apiKey.desc.loading")
          }
          label={t("settings.ai.apiKey")}
        >
          <div className="settings-key-row">
            <input
              className="settings-input settings-input-key"
              disabled={!keychainReady}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                keychainReady
                  ? t("settings.ai.apiKey.placeholder")
                  : t("settings.ai.apiKey.loading")
              }
              type={showKey ? "text" : "password"}
              value={apiKey}
            />
            <button
              className="settings-key-toggle"
              onClick={() => setShowKey((v) => !v)}
              title={
                showKey
                  ? t("settings.ai.apiKey.hide")
                  : t("settings.ai.apiKey.show")
              }
            >
              {showKey
                ? t("settings.ai.apiKey.hide")
                : t("settings.ai.apiKey.show")}
            </button>
          </div>
        </SettingsRow>
      )}

      {provider === "ollama" && (
        <SettingsRow
          description={t("settings.ai.ollamaUrl.desc")}
          label={t("settings.ai.ollamaUrl")}
        >
          <input
            className="settings-input"
            onChange={(e) => setOllamaUrl(e.target.value)}
            placeholder={t("settings.ai.ollamaUrl.placeholder")}
            type="text"
            value={ollamaUrl}
          />
        </SettingsRow>
      )}

      <SettingsRow
        description={t("settings.ai.model.desc")}
        label={t("settings.ai.model")}
      >
        <div className="settings-model-row">
          {customMode || (models.length === 0 && !modelsLoading) ? (
            <input
              className="settings-input settings-input-model"
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("settings.ai.model.placeholder")}
              type="text"
              value={model}
            />
          ) : (
            <select
              className="settings-select settings-select-model"
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setCustomMode(true);
                } else {
                  setModel(e.target.value);
                }
              }}
              value={model}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value="__custom__">{t("common.custom")}...</option>
            </select>
          )}
          <button
            className="settings-model-refresh"
            disabled={!canFetchModels || modelsLoading}
            onClick={fetchModels}
            title={
              !canFetchModels
                ? t("settings.ai.model.keyFirst")
                : t("settings.ai.model.fetchTooltip")
            }
          >
            {modelsLoading ? (
              <span className="settings-model-spinner" />
            ) : (
              "\u21BB"
            )}
          </button>
        </div>
      </SettingsRow>

      {modelsError &&
        (() => {
          const formatted = formatAIError(modelsError);
          return (
            <div className="settings-model-error">
              <strong>{formatted.title}</strong>
              <span>{formatted.detail}</span>
            </div>
          );
        })()}

      <SettingsSectionHeader title={t("settings.ai.modelSelection")} />

      <SettingsRow
        description={t("settings.ai.autoModel.desc")}
        label={t("settings.ai.autoModel")}
      >
        <ToggleSwitch
          checked={autoModelEnabled}
          onChange={setAutoModelEnabled}
        />
      </SettingsRow>

      {autoModelEnabled && (
        <>
          <TaskModelSelector
            configuredProviders={configuredProviders}
            defaultModel={model}
            defaultProvider={provider}
            description={t("settings.ai.ghostTextModel.desc")}
            fetchModelsForProvider={fetchModelsForProvider}
            label={t("settings.ai.ghostTextModel")}
            onModelChange={(m) => setModelForTask("ghost-text", m)}
            onProviderChange={(p) => setProviderForTask("ghost-text", p)}
            taskModel={modelForGhostText}
            taskProvider={providerForGhostText}
          />
          <TaskModelSelector
            configuredProviders={configuredProviders}
            defaultModel={model}
            defaultProvider={provider}
            description={t("settings.ai.inlineEditModel.desc")}
            fetchModelsForProvider={fetchModelsForProvider}
            label={t("settings.ai.inlineEditModel")}
            onModelChange={(m) => setModelForTask("inline-edit", m)}
            onProviderChange={(p) => setProviderForTask("inline-edit", p)}
            taskModel={modelForInlineEdit}
            taskProvider={providerForInlineEdit}
          />
          <TaskModelSelector
            configuredProviders={configuredProviders}
            defaultModel={model}
            defaultProvider={provider}
            description={t("settings.ai.chatModel.desc")}
            fetchModelsForProvider={fetchModelsForProvider}
            label={t("settings.ai.chatModel")}
            onModelChange={(m) => setModelForTask("chat", m)}
            onProviderChange={(p) => setProviderForTask("chat", p)}
            taskModel={modelForChat}
            taskProvider={providerForChat}
          />
          <TaskModelSelector
            configuredProviders={configuredProviders}
            defaultModel={model}
            defaultProvider={provider}
            description={t("settings.ai.agentModel.desc")}
            fetchModelsForProvider={fetchModelsForProvider}
            label={t("settings.ai.agentModel")}
            onModelChange={(m) => setModelForTask("agent", m)}
            onProviderChange={(p) => setProviderForTask("agent", p)}
            taskModel={modelForAgent}
            taskProvider={providerForAgent}
          />
        </>
      )}

      <SettingsSectionHeader title={t("settings.ai.privacy")} />

      <SettingsRow
        description={t("settings.ai.privacyMode.desc")}
        label={t("settings.ai.privacyMode")}
      >
        <ToggleSwitch checked={privacyMode} onChange={setPrivacyMode} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.ai.ghostText")} />

      <SettingsRow
        description={t("settings.ai.ghostTextEnabled.desc")}
        label={t("settings.ai.ghostTextEnabled")}
      >
        <ToggleSwitch
          checked={ghostTextEnabled}
          onChange={setGhostTextEnabled}
        />
      </SettingsRow>

      {ghostTextEnabled && (
        <>
          <SettingsRow
            description={t("settings.ai.debounce.desc").replace(
              "{value}",
              String(ghostTextDebounceMs),
            )}
            label={t("settings.ai.debounce")}
          >
            <input
              className="settings-range"
              max={2000}
              min={200}
              onChange={(e) => setGhostTextDebounceMs(Number(e.target.value))}
              step={100}
              type="range"
              value={ghostTextDebounceMs}
            />
          </SettingsRow>

          <SettingsRow
            description={t("settings.ai.maxLength.desc").replace(
              "{value}",
              String(maxSuggestionLength),
            )}
            label={t("settings.ai.maxLength")}
          >
            <input
              className="settings-range"
              max={500}
              min={20}
              onChange={(e) => setMaxSuggestionLength(Number(e.target.value))}
              step={10}
              type="range"
              value={maxSuggestionLength}
            />
          </SettingsRow>
        </>
      )}

      <SettingsSectionHeader title={t("settings.ai.customCommands")} />
      <CustomAICommandEditor />
    </div>
  );
}

// ─── AI Tab ─────────────────────────────────────────────

function TaskModelSelector({
  label,
  description,
  taskProvider,
  taskModel,
  onProviderChange,
  onModelChange,
  configuredProviders,
  defaultProvider,
  defaultModel,
  fetchModelsForProvider,
}: {
  configuredProviders: AIProvider[];
  defaultModel: string;
  defaultProvider: AIProvider;
  description: string;
  fetchModelsForProvider: (provider: AIProvider) => Promise<ModelInfo[]>;
  label: string;
  onModelChange: (model: string) => void;
  onProviderChange: (provider: "" | AIProvider) => void;
  taskModel: string;
  taskProvider: "" | AIProvider;
}) {
  const { t } = useTranslation();
  const [taskModels, setTaskModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const effectiveProvider = taskProvider || defaultProvider;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchModelsForProvider(effectiveProvider).then((result) => {
      if (!cancelled) {
        setTaskModels(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveProvider, fetchModelsForProvider]);

  return (
    <SettingsRow description={description} label={label}>
      <div className="settings-task-model-row">
        <select
          className="settings-select settings-select-task-provider"
          onChange={(e) => {
            const val = e.target.value as "" | AIProvider;
            onProviderChange(val);
            if (val) onModelChange("");
          }}
          value={taskProvider}
        >
          <option value="">
            {t("settings.ai.useDefault")} ({PROVIDER_LABELS[defaultProvider]})
          </option>
          {configuredProviders.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p]}
            </option>
          ))}
        </select>
        {loading ? (
          <span className="settings-model-spinner" />
        ) : (
          <select
            className="settings-select settings-select-task-model"
            onChange={(e) => onModelChange(e.target.value)}
            value={taskModel}
          >
            {!taskProvider && !taskModel ? (
              <option value="">{defaultModel}</option>
            ) : (
              <option value="">{t("settings.ai.selectModel")}</option>
            )}
            {taskModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </SettingsRow>
  );
}

// ─── Font Family Picker ─────────────────────────────────

const FONT_OPTIONS = [
  { value: "system-ui", label: "System Default" },
  { value: "Pretendard", label: "Pretendard" },
  { value: "Inter", label: "Inter" },
  { value: "Noto Sans", label: "Noto Sans" },
  { value: "Noto Sans KR", label: "Noto Sans KR" },
  { value: "IBM Plex Sans", label: "IBM Plex Sans" },
  { value: "Roboto", label: "Roboto" },
  { value: "Lato", label: "Lato" },
  { value: "Open Sans", label: "Open Sans" },
  { value: "Source Sans 3", label: "Source Sans 3" },
  { value: "Merriweather", label: "Merriweather" },
  { value: "Georgia", label: "Georgia" },
  { value: "Lora", label: "Lora" },
  { value: "Nanum Gothic", label: "Nanum Gothic" },
];

interface RegistryEntry {
  name: string;
  settings?: SettingDef[];
}

// ─── Extension Settings Helpers (merged from ExtensionsTab) ──

interface SettingDef {
  default: unknown;
  description: string;
  key: string;
  label: string;
  max?: number;
  min?: number;
  options?: SettingOption[];
  placeholder?: string;
  step?: number;
  type: "boolean" | "number" | "select" | "string";
}
interface SettingOption {
  label: string;
  value: string;
}
function ActivityBarTab() {
  const { activityBarConfig, setActivityBarConfig, resetActivityBarConfig } =
    useSettingsStore();
  const { t } = useTranslation();

  const [draggingId, setDraggingId] = useState<null | string>(null);
  const [dropIndicator, setDropIndicator] = useState<null | {
    id: string;
    position: "after" | "before";
  }>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<null | { id: string; section: string }>(null);
  const dropRef = useRef<null | { id: string; position: "after" | "before" }>(
    null,
  );
  const configRef = useRef(activityBarConfig);
  configRef.current = activityBarConfig;

  const topItems = activityBarConfig.filter((i) => i.section === "top");
  const bottomItems = activityBarConfig.filter((i) => i.section === "bottom");

  const toggleItem = (id: string) => {
    setActivityBarConfig(
      activityBarConfig.map((item) =>
        item.id === id ? { ...item, visible: !item.visible } : item,
      ),
    );
  };

  const onPointerDown = useCallback(
    (id: string, section: string, e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { id, section };
      setDraggingId(id);

      const onMove = (moveE: PointerEvent) => {
        const state = dragRef.current;
        if (!state) return;

        let closestId: null | string = null;
        let closestPos: "after" | "before" = "before";
        let closestDist = Infinity;

        for (const [rowId, el] of rowRefs.current.entries()) {
          const rowItem = configRef.current.find((i) => i.id === rowId);
          if (
            !rowItem ||
            rowItem.section !== state.section ||
            rowId === state.id
          )
            continue;

          const rect = el.getBoundingClientRect();
          const midY = rect.top + rect.height / 2;
          const dist = Math.abs(moveE.clientY - midY);

          if (dist < closestDist) {
            closestDist = dist;
            closestId = rowId;
            closestPos = moveE.clientY < midY ? "before" : "after";
          }
        }

        dropRef.current = closestId
          ? { id: closestId, position: closestPos }
          : null;
        setDropIndicator(dropRef.current);
      };

      const onUp = () => {
        const state = dragRef.current;
        const drop = dropRef.current;

        if (state && drop && state.id !== drop.id) {
          const config = [...configRef.current];
          const fromIdx = config.findIndex((i) => i.id === state.id);
          if (fromIdx !== -1) {
            const [item] = config.splice(fromIdx, 1);
            let toIdx = config.findIndex((i) => i.id === drop.id);
            if (toIdx !== -1) {
              if (drop.position === "after") toIdx += 1;
              config.splice(toIdx, 0, item);
              setActivityBarConfig(config);
            }
          }
        }

        dragRef.current = null;
        dropRef.current = null;
        setDraggingId(null);
        setDropIndicator(null);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [setActivityBarConfig],
  );

  const setRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const renderSection = (title: string, items: ActivityBarItemConfig[]) => (
    <>
      <SettingsSectionHeader title={title} />
      {items.map((item) => (
        <div
          className={`settings-row activity-bar-config-row${
            draggingId === item.id ? "activity-bar-dragging" : ""
          }${
            dropIndicator?.id === item.id
              ? ` activity-bar-drop-${dropIndicator.position}`
              : ""
          }`}
          key={item.id}
          ref={(el) => setRowRef(item.id, el)}
        >
          <div className="activity-bar-config-left">
            <div
              className="activity-bar-config-drag-handle"
              onPointerDown={(e) => onPointerDown(item.id, item.section, e)}
            >
              {"\u2807"}
            </div>
            <span
              className={`settings-row-label ${!item.visible ? "activity-bar-config-hidden" : ""}`}
            >
              {t(`settings.activitybar.item.${item.id}`)}
            </span>
          </div>
          <div className="settings-row-control">
            <ToggleSwitch
              checked={item.visible}
              onChange={() => toggleItem(item.id)}
            />
          </div>
        </div>
      ))}
    </>
  );

  return (
    <div className="settings-section">
      <div className="settings-row-description" style={{ marginBottom: 12 }}>
        {t("settings.activitybar.desc")}
      </div>
      {renderSection(t("settings.activitybar.sidebarPanels"), topItems)}
      {renderSection(t("settings.activitybar.rightPanels"), bottomItems)}
      <div style={{ marginTop: 16 }}>
        <button className="theme-action-btn" onClick={resetActivityBarConfig}>
          {t("settings.activitybar.resetDefault")}
        </button>
      </div>
    </div>
  );
}

function ExtensionSettingRow({ setting }: { setting: SettingDef }) {
  const { extensionSettings, setExtensionSetting } = useSettingsStore();
  const value = extensionSettings[setting.key] ?? setting.default;
  switch (setting.type) {
    case "boolean":
      return (
        <SettingsRow description={setting.description} label={setting.label}>
          <ToggleSwitch
            checked={!!value}
            onChange={(v) => setExtensionSetting(setting.key, v)}
          />
        </SettingsRow>
      );
    case "number":
      return (
        <SettingsRow
          description={`${setting.description} (${value})`}
          label={setting.label}
        >
          <input
            className="settings-range"
            max={setting.max ?? 100}
            min={setting.min ?? 0}
            onChange={(e) =>
              setExtensionSetting(setting.key, Number(e.target.value))
            }
            step={setting.step ?? 1}
            type="range"
            value={value as number}
          />
        </SettingsRow>
      );
    case "select":
      return (
        <SettingsRow description={setting.description} label={setting.label}>
          <select
            className="settings-select"
            onChange={(e) => setExtensionSetting(setting.key, e.target.value)}
            value={value as string}
          >
            {(setting.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </SettingsRow>
      );
    case "string":
      return (
        <SettingsRow description={setting.description} label={setting.label}>
          <input
            className="settings-input"
            onChange={(e) => setExtensionSetting(setting.key, e.target.value)}
            placeholder={setting.placeholder ?? ""}
            type="text"
            value={value as string}
          />
        </SettingsRow>
      );
    default:
      return null;
  }
}

function FontFamilyPicker({
  value,
  onChange,
}: {
  onChange: (v: string) => void;
  value: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = search
    ? FONT_OPTIONS.filter((f) =>
        f.label.toLowerCase().includes(search.toLowerCase()),
      )
    : FONT_OPTIONS;

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleSelect = (fontValue: string) => {
    onChange(fontValue);
    setSearch("");
    setOpen(false);
  };

  return (
    <div className="settings-font-picker" ref={containerRef}>
      <input
        className="settings-input"
        onChange={(e) => {
          setSearch(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setSearch("");
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && search) {
            // Allow custom font name
            onChange(search);
            setSearch("");
            setOpen(false);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={t("settings.editor.fontPicker.placeholder")}
        type="text"
        value={open ? search : value}
      />
      {open && (
        <div className="settings-font-dropdown">
          {filtered.map((font) => (
            <button
              className={`settings-font-option ${font.value === value ? "settings-font-option-active" : ""}`}
              key={font.value}
              onClick={() => handleSelect(font.value)}
              style={{ fontFamily: font.value }}
            >
              {font.value === "system-ui"
                ? t("settings.editor.fontPicker.systemDefault")
                : font.label}
            </button>
          ))}
          {filtered.length === 0 && search && (
            <button
              className="settings-font-option"
              onClick={() => handleSelect(search)}
            >
              {t("settings.editor.fontPicker.useCustom").replace(
                "{font}",
                search,
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatExtName(name: string): string {
  const spaced = name.replace(/([A-Z])/g, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ─── Shared Components ──────────────────────────────────

function getExtensionsWithSettings() {
  const allEntries: RegistryEntry[] = [
    ...(registry.nodes as RegistryEntry[]),
    ...(registry.marks as RegistryEntry[]),
    ...(registry.plugins as RegistryEntry[]),
  ];
  return allEntries
    .filter(
      (e): e is RegistryEntry & { settings: SettingDef[] } =>
        Array.isArray(e.settings) && e.settings.length > 0,
    )
    .map((e) => ({ name: e.name, settings: e.settings }));
}

function KeybindingsTab() {
  const { t } = useTranslation();
  const {
    keybindingOverrides,
    setKeybindingOverride,
    removeKeybindingOverride,
    resetAllKeybindings,
  } = useSettingsStore();
  const merged = getMergedKeybindings(keybindingOverrides);
  const [filter, setFilter] = useState("");
  const [capturingId, setCapturingId] = useState<null | string>(null);
  const [capturedKey, setCapturedKey] = useState<null | string>(null);
  const [conflict, setConflict] = useState<MergedKeybinding | null>(null);

  const isMac = navigator.platform.includes("Mac");

  const filtered = useMemo(() => {
    if (!filter) return merged;
    const q = filter.toLowerCase();
    return merged.filter(
      (e) =>
        t(e.label).toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        formatKeyForDisplay(e.activeKey, isMac).toLowerCase().includes(q),
    );
  }, [merged, filter, t, isMac]);

  const grouped = useMemo(() => {
    const map = new Map<string, MergedKeybinding[]>();
    for (const entry of filtered) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return map;
  }, [filtered]);

  // Key capture handler
  useEffect(() => {
    if (!capturingId) return;

    const handleCapture = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        setCapturingId(null);
        setCapturedKey(null);
        setConflict(null);
        return;
      }

      if (["Alt", "Control", "Meta", "Shift"].includes(e.key)) return;

      const normalized = normalizeKeyEvent(e, isMac);
      if (!normalized) return;

      setCapturedKey(normalized);
      const conflicting = findConflict(
        capturingId,
        normalized,
        keybindingOverrides,
      );
      setConflict(conflicting);
    };

    window.addEventListener("keydown", handleCapture, true);
    return () => window.removeEventListener("keydown", handleCapture, true);
  }, [capturingId, keybindingOverrides, isMac]);

  const confirmCapture = () => {
    if (!capturingId || !capturedKey) return;
    if (conflict) {
      removeKeybindingOverride(conflict.id);
    }
    setKeybindingOverride(capturingId, capturedKey);
    setCapturingId(null);
    setCapturedKey(null);
    setConflict(null);
  };

  const startCapture = (id: string) => {
    setCapturingId(id);
    setCapturedKey(null);
    setConflict(null);
  };

  return (
    <div className="settings-section">
      <div className="keybindings-filter">
        <input
          className="settings-search-input"
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("keybindings.search.placeholder")}
          type="text"
          value={filter}
        />
      </div>

      {filtered.length === 0 && filter && (
        <div className="settings-empty">
          {t("keybindings.search.empty").replace("{query}", filter)}
        </div>
      )}

      {KEYBINDING_CATEGORIES.filter((cat) => grouped.has(cat)).map((cat) => (
        <div key={cat}>
          <SettingsSectionHeader title={t(CATEGORY_LABELS[cat])} />
          {grouped.get(cat)!.map((entry) => (
            <div
              className={`keybinding-row${entry.isOverridden ? "keybinding-overridden" : ""}${!entry.customizable ? "keybinding-readonly-row" : ""}`}
              key={entry.id}
            >
              <span className="keybinding-label">{t(entry.label)}</span>
              <span className="keybinding-key">
                {capturingId === entry.id ? (
                  <span className="keybinding-capture">
                    {capturedKey ? (
                      <>
                        <span className="keybinding-capture-key">
                          {formatKeyForDisplay(capturedKey, isMac)}
                        </span>
                        {conflict && (
                          <span className="keybinding-conflict">
                            {t("keybindings.conflict").replace(
                              "{command}",
                              t(conflict.label),
                            )}
                          </span>
                        )}
                        <button
                          className="keybinding-confirm-btn"
                          onClick={confirmCapture}
                        >
                          {"\u21A9"}
                        </button>
                      </>
                    ) : (
                      <span className="keybinding-capture-prompt">
                        {t("keybindings.capture.prompt")}
                      </span>
                    )}
                  </span>
                ) : (
                  <kbd className="keybinding-kbd">
                    {formatKeyForDisplay(entry.activeKey, isMac)}
                  </kbd>
                )}
              </span>
              <span className="keybinding-actions">
                {entry.customizable ? (
                  <>
                    {entry.isOverridden && (
                      <button
                        className="keybinding-reset-btn"
                        onClick={() => removeKeybindingOverride(entry.id)}
                        title={t("keybindings.reset")}
                      >
                        {"\u21BA"}
                      </button>
                    )}
                    <button
                      className="keybinding-edit-btn"
                      onClick={() => startCapture(entry.id)}
                    >
                      {t("keybindings.edit")}
                    </button>
                  </>
                ) : (
                  <span className="keybinding-readonly-badge" />
                )}
              </span>
            </div>
          ))}
        </div>
      ))}

      {Object.keys(keybindingOverrides).length > 0 && (
        <div className="keybinding-reset-all">
          <button
            className="settings-btn"
            onClick={() => {
              if (confirm(t("keybindings.resetAll.confirm"))) {
                resetAllKeybindings();
              }
            }}
          >
            {t("keybindings.resetAll")}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Language Tab ──────────────────────────────────────

function LanguageTab() {
  const { locale, setLocale } = useSettingsStore();
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

      <div
        className="settings-row-description"
        style={{ marginTop: 12, fontStyle: "italic" }}
      >
        {t("settings.language.reloadNotice")}
      </div>
    </div>
  );
}

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
          {AVAILABLE_LOCALES.map((loc) => (
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

function SettingsRow({
  label,
  description,
  children,
}: {
  children: React.ReactNode;
  description?: string;
  label: string;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <span className="settings-row-label">{label}</span>
        {description && (
          <span className="settings-row-description">{description}</span>
        )}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
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

function SettingsSectionHeader({ title }: { title: string }) {
  return <div className="settings-section-header">{title}</div>;
}

function ThemeMiniPreview({ theme }: { theme: ThemeDef }) {
  const c = theme.colors;
  return (
    <div
      className="theme-preview"
      style={{ background: c["--color-bg-primary"] }}
    >
      <div
        className="theme-preview-sidebar"
        style={{
          background: c["--color-bg-sidebar"],
          borderRight: `1px solid ${c["--color-border"]}`,
        }}
      >
        <div
          className="theme-preview-sidebar-item"
          style={{ background: c["--color-bg-tertiary"] }}
        />
        <div
          className="theme-preview-sidebar-item"
          style={{ background: c["--color-bg-tertiary"] }}
        />
        <div
          className="theme-preview-sidebar-item"
          style={{ background: c["--color-bg-tertiary"] }}
        />
      </div>
      <div
        className="theme-preview-editor"
        style={{ background: c["--color-editor-bg"] }}
      >
        <div
          className="theme-preview-heading"
          style={{ color: c["--color-editor-text"] }}
        >
          Heading
        </div>
        <div
          className="theme-preview-text"
          style={{ color: c["--color-editor-text"] }}
        >
          Some{" "}
          <span style={{ color: c["--color-accent"], fontWeight: 600 }}>
            bold
          </span>{" "}
          text
        </div>
        <div
          className="theme-preview-quote"
          style={{
            borderLeft: `2px solid ${c["--color-accent"]}`,
            color: c["--color-text-secondary"],
            paddingLeft: 6,
          }}
        >
          blockquote
        </div>
        <div
          className="theme-preview-code"
          style={{
            background: c["--color-bg-tertiary"],
            color: c["--color-editor-text"],
          }}
        >
          code
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      className={`settings-toggle ${checked ? "settings-toggle-on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

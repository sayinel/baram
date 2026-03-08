// Settings Modal — 5-tab settings (General, Editor, Appearance, Markdown, AI)
// Obsidian-style layout: label + description per row, section headers for grouping
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useAIStore } from "../../stores/ai-store";
import { CustomAICommandEditor } from "./CustomAICommandEditor";
import { llmListModels } from "../../ipc/invoke";
import { formatAIError } from "../../utils/format-error";
import type { ModelInfo } from "../../ipc/types";
import { ThemeEditor } from "./ThemeEditor";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "../../ipc/invoke";
import { MigrationDialog } from "../journal/MigrationDialog";
import { initJournalTemplatesDir } from "../../utils/journal-templates";
import { BUILT_IN_THEMES } from "../../types/theme";
import type { ThemeDef } from "../../types/theme";
import { THEME_COLOR_KEYS } from "../../types/theme";
import registry from "../../extensions/registry.json";
import { useWorkspaceStore, BUILTIN_PRESETS } from "../../stores/workspace-store";
import type { WorkspacePreset } from "../../stores/workspace-store";
import type { ActivityBarItemConfig } from "../../stores/settings-store";
import { useTranslation } from "../../i18n/useTranslation";
import { AVAILABLE_LOCALES, LOCALE_LABELS } from "../../i18n";
import type { Locale } from "../../i18n";
import { normalizeKeyEvent, formatKeyForDisplay } from "../../keybindings/key-utils";
import { KEYBINDING_CATEGORIES, CATEGORY_LABELS } from "../../keybindings/keybinding-registry";
import { getMergedKeybindings, findConflict, type MergedKeybinding } from "../../keybindings/use-keybindings";

type SettingsTab = "general" | "editor" | "appearance" | "markdown" | "ai" | "activitybar" | "language" | "keybindings";

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "\u2699" },
  { id: "editor", label: "Editor", icon: "\u270E" },
  { id: "appearance", label: "Appearance", icon: "\u25D1" },
  { id: "markdown", label: "Markdown", icon: "M\u2193" },
  { id: "ai", label: "AI", icon: "\u2726" },
  { id: "activitybar", label: "Activity Bar", icon: "\u25A4" },
  { id: "language", label: "Language", icon: "\uD83C\uDF10" },
  { id: "keybindings", label: "Keybindings", icon: "\u2328" },
];

interface SearchableSetting {
  id: string;
  label: string;
  description: string;
  category: SettingsTab;
  section: string;
  keywords?: string[];
}

const SETTINGS_REGISTRY: SearchableSetting[] = [
  // General
  { id: "onLaunch", label: "settings.general.onLaunch", description: "settings.general.onLaunch.desc", category: "general", section: "settings.general.startup" },
  { id: "showWelcome", label: "settings.general.showWelcome", description: "settings.general.showWelcome.desc", category: "general", section: "settings.general.startup" },
  { id: "autoSave", label: "settings.general.autoSave", description: "settings.general.autoSave.desc", category: "general", section: "settings.general.saving" },
  { id: "autoSaveDelay", label: "settings.general.saveDelay", description: "settings.general.saveDelay.desc", category: "general", section: "settings.general.saving" },
  { id: "spellCheck", label: "settings.general.spellCheck", description: "settings.general.spellCheck.desc", category: "general", section: "settings.general.system" },
  { id: "wikilinkFormat", label: "settings.general.linkFormat", description: "settings.general.linkFormat.desc", category: "general", section: "settings.general.links", keywords: ["wikilink", "markdown", "link"] },
  { id: "autoUpdateLinks", label: "settings.general.autoUpdateLinks", description: "settings.general.autoUpdateLinks.desc", category: "general", section: "settings.general.links" },
  { id: "snapshotInterval", label: "settings.general.snapshotInterval", description: "settings.general.snapshotInterval.desc", category: "general", section: "settings.general.snapshots", keywords: ["version", "history", "backup"] },
  { id: "snapshotMaxCount", label: "settings.general.snapshotMaxCount", description: "settings.general.snapshotMaxCount.desc", category: "general", section: "settings.general.snapshots" },
  { id: "journalEnabled", label: "settings.general.journalEnabled", description: "settings.general.journalEnabled.desc", category: "general", section: "settings.general.journal", keywords: ["daily", "note", "diary"] },
  // Editor
  { id: "fontFamily", label: "settings.editor.fontFamily", description: "settings.editor.fontFamily.desc", category: "editor", section: "settings.editor.font", keywords: ["typeface", "font"] },
  { id: "fontSize", label: "settings.editor.fontSize", description: "settings.editor.fontSize.desc", category: "editor", section: "settings.editor.font" },
  { id: "lineHeight", label: "settings.editor.lineHeight", description: "settings.editor.lineHeight.desc", category: "editor", section: "settings.editor.font" },
  { id: "tabSize", label: "settings.editor.tabSize", description: "settings.editor.tabSize.desc", category: "editor", section: "settings.editor.behavior", keywords: ["indent", "space"] },
  { id: "autoPairBrackets", label: "settings.editor.autoPairBrackets", description: "settings.editor.autoPairBrackets.desc", category: "editor", section: "settings.editor.behavior" },
  { id: "lineNumbers", label: "settings.editor.lineNumbers", description: "settings.editor.lineNumbers.desc", category: "editor", section: "settings.editor.display" },
  { id: "editorMaxWidth", label: "settings.editor.maxWidth", description: "settings.editor.maxWidth.desc", category: "editor", section: "settings.editor.display" },
  // Appearance
  { id: "activeThemeId", label: "settings.appearance.theme", description: "settings.appearance.theme", category: "appearance", section: "settings.appearance.theme", keywords: ["dark", "light", "color", "theme"] },
  // Markdown
  { id: "inlineMath", label: "settings.markdown.inlineMath", description: "settings.markdown.inlineMath.desc", category: "markdown", section: "settings.markdown.extendedSyntax", keywords: ["katex", "latex", "equation"] },
  { id: "highlight", label: "settings.markdown.highlight", description: "settings.markdown.highlight.desc", category: "markdown", section: "settings.markdown.extendedSyntax" },
  { id: "strikethrough", label: "settings.markdown.strikethrough", description: "settings.markdown.strikethrough.desc", category: "markdown", section: "settings.markdown.extendedSyntax" },
  { id: "smartPunctuation", label: "settings.markdown.smartPunctuation", description: "settings.markdown.smartPunctuation.desc", category: "markdown", section: "settings.markdown.typography" },
  // AI
  { id: "provider", label: "settings.ai.aiProvider", description: "settings.ai.aiProvider.desc", category: "ai", section: "settings.ai.provider", keywords: ["claude", "openai", "ollama", "gemini"] },
  { id: "apiKey", label: "settings.ai.apiKey", description: "settings.ai.apiKey", category: "ai", section: "settings.ai.provider" },
  { id: "model", label: "settings.ai.model", description: "settings.ai.model.desc", category: "ai", section: "settings.ai.provider" },
  { id: "ghostTextEnabled", label: "settings.ai.ghostTextEnabled", description: "settings.ai.ghostTextEnabled.desc", category: "ai", section: "settings.ai.ghostText", keywords: ["autocomplete", "suggestion"] },
  { id: "privacyMode", label: "settings.ai.privacyMode", description: "settings.ai.privacyMode.desc", category: "ai", section: "settings.ai.privacy" },
  // Activity Bar
  { id: "activityBarConfig", label: "settings.tab.activitybar", description: "settings.activitybar.desc", category: "activitybar", section: "settings.tab.activitybar", keywords: ["icon", "sidebar", "panel"] },
  // Language
  { id: "locale", label: "settings.language.title", description: "settings.language.interface.desc", category: "language", section: "settings.language.title", keywords: ["locale", "i18n", "korean", "english", "\uD55C\uAD6D\uC5B4"] },
  // Keybindings
  {
    id: "keybindings",
    label: "settings.tab.keybindings",
    description: "",
    category: "keybindings",
    section: "settings.tab.keybindings",
    keywords: ["shortcut", "key", "binding", "hotkey", "keyboard", "remap", "단축키", "키보드", "바인딩"],
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
        (s.keywords ?? []).some((k) => k.includes(q))
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
              type="text"
              className="settings-search"
              placeholder={t("settings.search.placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="settings-search-clear" onClick={() => setSearchQuery("")}>
                {"\u00D7"}
              </button>
            )}
          </div>
          <button className="settings-close" onClick={toggleSettings} title={t("common.close")}>
            {"\u00D7"}
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                className={`settings-nav-item ${activeTab === tab.id ? "settings-nav-active" : ""}`}
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
                query={searchQuery}
                onNavigate={(tab) => {
                  setActiveTab(tab);
                  setSearchQuery("");
                }}
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── General Tab ────────────────────────────────────────

function GeneralTab() {
  const { t } = useTranslation();
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [templatesInitMsg, setTemplatesInitMsg] = useState<string | null>(null);
  const {
    onLaunch, setOnLaunch,
    autoSave, setAutoSave,
    autoSaveDelay, setAutoSaveDelay,
    spellCheck, setSpellCheck,
    showWelcome, setShowWelcome,
    wikilinkFormat, setWikilinkFormat,
    autoUpdateLinks, setAutoUpdateLinks,
    snapshotInterval, setSnapshotInterval,
    snapshotMaxCount, setSnapshotMaxCount,
    journalEnabled, setJournalEnabled,
    journalDirectory, setJournalDirectory,
    journalFilenameFormat, setJournalFilenameFormat,
    journalTemplatePath, setJournalTemplatePath,
    journalStartupBehavior, setJournalStartupBehavior,
    journalUseHierarchy, setJournalUseHierarchy,
    journalWeeklyTemplate, setJournalWeeklyTemplate,
    journalMonthlyTemplate, setJournalMonthlyTemplate,
    journalYearlyTemplate, setJournalYearlyTemplate,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.general.startup")} />

      <SettingsRow label={t("settings.general.onLaunch")} description={t("settings.general.onLaunch.desc")}>
        <select
          className="settings-select"
          value={onLaunch}
          onChange={(e) => setOnLaunch(e.target.value as "newFile" | "restoreLastFolder" | "restoreLastFile")}
        >
          <option value="restoreLastFolder">{t("settings.general.onLaunch.restoreLastFolder")}</option>
          <option value="restoreLastFile">{t("settings.general.onLaunch.restoreLastFile")}</option>
          <option value="newFile">{t("settings.general.onLaunch.newFile")}</option>
        </select>
      </SettingsRow>

      <SettingsRow label={t("settings.general.showWelcome")} description={t("settings.general.showWelcome.desc")}>
        <ToggleSwitch checked={showWelcome} onChange={setShowWelcome} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.saving")} />

      <SettingsRow label={t("settings.general.autoSave")} description={t("settings.general.autoSave.desc")}>
        <ToggleSwitch checked={autoSave} onChange={setAutoSave} />
      </SettingsRow>

      {autoSave && (
        <SettingsRow label={t("settings.general.saveDelay")} description={t("settings.general.saveDelay.desc").replace("{value}", (autoSaveDelay / 1000).toFixed(1))}>
          <input
            type="range"
            className="settings-range"
            min={500}
            max={10000}
            step={500}
            value={autoSaveDelay}
            onChange={(e) => setAutoSaveDelay(Number(e.target.value))}
          />
        </SettingsRow>
      )}

      <SettingsSectionHeader title={t("settings.general.system")} />

      <SettingsRow label={t("settings.general.spellCheck")} description={t("settings.general.spellCheck.desc")}>
        <ToggleSwitch checked={spellCheck} onChange={setSpellCheck} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.links")} />

      <SettingsRow label={t("settings.general.linkFormat")} description={t("settings.general.linkFormat.desc")}>
        <select
          className="settings-select"
          value={wikilinkFormat}
          onChange={(e) => setWikilinkFormat(e.target.value as "wikilink" | "markdown")}
        >
          <option value="wikilink">[[Wikilink]]</option>
          <option value="markdown">[Markdown](link)</option>
        </select>
      </SettingsRow>

      <SettingsRow label={t("settings.general.autoUpdateLinks")} description={t("settings.general.autoUpdateLinks.desc")}>
        <ToggleSwitch checked={autoUpdateLinks} onChange={setAutoUpdateLinks} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.snapshots")} />

      <SettingsRow label={t("settings.general.snapshotInterval")} description={t("settings.general.snapshotInterval.desc").replace("{value}", String(snapshotInterval))}>
        <input
          type="range"
          className="settings-range"
          min={0}
          max={120}
          step={5}
          value={snapshotInterval}
          onChange={(e) => setSnapshotInterval(Number(e.target.value))}
        />
      </SettingsRow>

      <SettingsRow label={t("settings.general.snapshotMaxCount")} description={t("settings.general.snapshotMaxCount.desc").replace("{value}", String(snapshotMaxCount))}>
        <input
          type="range"
          className="settings-range"
          min={5}
          max={200}
          step={5}
          value={snapshotMaxCount}
          onChange={(e) => setSnapshotMaxCount(Number(e.target.value))}
        />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.general.journal")} />

      <SettingsRow label={t("settings.general.journalEnabled")} description={t("settings.general.journalEnabled.desc")}>
        <ToggleSwitch checked={journalEnabled} onChange={setJournalEnabled} />
      </SettingsRow>

      {journalEnabled && (
        <>
          <SettingsRow label={t("settings.general.journalDirectory")} description={t("settings.general.journalDirectory.desc")}>
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalDirectory}
                readOnly
                placeholder={t("settings.general.journalDirectory.placeholder")}
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

          <SettingsRow label={t("settings.general.journalFilenameFormat")} description={t("settings.general.journalFilenameFormat.desc")}>
            <select
              className="settings-select"
              value={journalFilenameFormat}
              onChange={(e) => setJournalFilenameFormat(e.target.value)}
            >
              <option value="YYYY-MM-DD.md">YYYY-MM-DD.md</option>
              <option value="YYYYMMDD.md">YYYYMMDD.md</option>
            </select>
          </SettingsRow>

          <SettingsRow label={t("settings.general.journalTemplate")} description={t("settings.general.journalTemplate.desc")}>
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalTemplatePath}
                readOnly
                placeholder={t("settings.general.journalTemplate.placeholder")}
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

          <SettingsRow label={t("settings.general.journalStartup")} description={t("settings.general.journalStartup.desc")}>
            <select
              className="settings-select"
              value={journalStartupBehavior}
              onChange={(e) => setJournalStartupBehavior(e.target.value as "openJournal" | "nothing")}
            >
              <option value="openJournal">{t("settings.general.journalStartup.openJournal")}</option>
              <option value="nothing">{t("settings.general.journalStartup.nothing")}</option>
            </select>
          </SettingsRow>

          <SettingsRow label={t("settings.general.journalHierarchy")} description={t("settings.general.journalHierarchy.desc")}>
            <ToggleSwitch
              checked={journalUseHierarchy}
              onChange={setJournalUseHierarchy}
            />
          </SettingsRow>

          {journalDirectory && (
            <SettingsRow label={t("settings.general.journalMigrate")} description={t("settings.general.journalMigrate.desc")}>
              <button
                className="settings-key-toggle"
                onClick={() => setMigrationOpen(true)}
              >
                {t("settings.general.journalMigrate.button")}
              </button>
            </SettingsRow>
          )}

          <SettingsSectionHeader title={t("settings.general.periodicTemplates")} />

          <SettingsRow label={t("settings.general.weeklyTemplate")} description={t("settings.general.weeklyTemplate.desc")}>
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalWeeklyTemplate}
                readOnly
                placeholder={t("settings.general.journalTemplate.placeholder")}
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

          <SettingsRow label={t("settings.general.monthlyTemplate")} description={t("settings.general.monthlyTemplate.desc")}>
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalMonthlyTemplate}
                readOnly
                placeholder={t("settings.general.journalTemplate.placeholder")}
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

          <SettingsRow label={t("settings.general.yearlyTemplate")} description={t("settings.general.yearlyTemplate.desc")}>
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalYearlyTemplate}
                readOnly
                placeholder={t("settings.general.journalTemplate.placeholder")}
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

          <SettingsSectionHeader title={t("settings.general.journalAI")} />

          <SettingsRow label={t("settings.general.journalAIAutoSuggest")} description={t("settings.general.journalAIAutoSuggest.desc")}>
            <ToggleSwitch
              checked={useSettingsStore.getState().journalAIAutoSuggest}
              onChange={(v) => useSettingsStore.getState().setJournalAIAutoSuggest(v)}
            />
          </SettingsRow>

          {journalDirectory && (
            <SettingsRow
              label={t("settings.general.createTemplateFiles")}
              description={t("settings.general.createTemplateFiles.desc").replace("{dir}", journalDirectory)}
            >
              <div className="settings-key-row">
                <button
                  className="settings-key-toggle"
                  onClick={async () => {
                    try {
                      await initJournalTemplatesDir(journalDirectory);
                      setTemplatesInitMsg(t("settings.general.createTemplateFiles.success"));
                    } catch {
                      setTemplatesInitMsg(t("settings.general.createTemplateFiles.error"));
                    }
                    setTimeout(() => setTemplatesInitMsg(null), 3000);
                  }}
                >
                  {t("settings.general.createTemplateFiles.button")}
                </button>
                {templatesInitMsg && (
                  <span className="settings-row-description" style={{ marginLeft: 8 }}>
                    {templatesInitMsg}
                  </span>
                )}
              </div>
            </SettingsRow>
          )}
        </>
      )}

      <MigrationDialog
        open={migrationOpen}
        onClose={() => setMigrationOpen(false)}
        journalDir={journalDirectory}
      />
    </div>
  );
}

// ─── Editor Tab ─────────────────────────────────────────

function EditorTab() {
  const { t } = useTranslation();
  const {
    fontFamily, setFontFamily,
    fontSize, setFontSize,
    lineHeight, setLineHeight,
    tabSize, setTabSize,
    lineNumbers, setLineNumbers,
    autoPairBrackets, setAutoPairBrackets,
    editorMaxWidth, setEditorMaxWidth,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.editor.font")} />

      <SettingsRow label={t("settings.editor.fontFamily")} description={t("settings.editor.fontFamily.desc")}>
        <FontFamilyPicker value={fontFamily} onChange={setFontFamily} />
      </SettingsRow>

      <SettingsRow label={t("settings.editor.fontSize")} description={t("settings.editor.fontSize.desc").replace("{value}", String(fontSize))}>
        <input
          type="range"
          className="settings-range"
          min={8}
          max={32}
          step={1}
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
        />
      </SettingsRow>

      <SettingsRow label={t("settings.editor.lineHeight")} description={t("settings.editor.lineHeight.desc").replace("{value}", lineHeight.toFixed(2))}>
        <input
          type="range"
          className="settings-range"
          min={1.0}
          max={3.0}
          step={0.05}
          value={lineHeight}
          onChange={(e) => setLineHeight(Number(e.target.value))}
        />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.editor.behavior")} />

      <SettingsRow label={t("settings.editor.tabSize")} description={t("settings.editor.tabSize.desc")}>
        <select
          className="settings-select"
          value={tabSize}
          onChange={(e) => setTabSize(Number(e.target.value))}
        >
          <option value={2}>{t("settings.editor.tabSize.2spaces")}</option>
          <option value={4}>{t("settings.editor.tabSize.4spaces")}</option>
        </select>
      </SettingsRow>

      <SettingsRow label={t("settings.editor.autoPairBrackets")} description={t("settings.editor.autoPairBrackets.desc")}>
        <ToggleSwitch checked={autoPairBrackets} onChange={setAutoPairBrackets} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.editor.display")} />

      <SettingsRow label={t("settings.editor.lineNumbers")} description={t("settings.editor.lineNumbers.desc")}>
        <ToggleSwitch checked={lineNumbers} onChange={setLineNumbers} />
      </SettingsRow>

      <SettingsRow label={t("settings.editor.maxWidth")} description={t("settings.editor.maxWidth.desc").replace("{value}", editorMaxWidth === 0 ? t("settings.editor.maxWidth.noLimit") : editorMaxWidth + "px")}>
        <input
          type="range"
          className="settings-range"
          min={0}
          max={2048}
          step={50}
          value={editorMaxWidth}
          onChange={(e) => setEditorMaxWidth(Number(e.target.value))}
        />
      </SettingsRow>
    </div>
  );
}

// ─── Appearance Tab ─────────────────────────────────────

function AppearanceTab() {
  const { t } = useTranslation();
  const { activeThemeId, customThemes, setActiveTheme, saveCustomTheme, deleteCustomTheme } =
    useSettingsStore();
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
            <div className="theme-preview-half" style={{ background: "#ffffff" }}>
              <div className="theme-preview-sidebar" style={{ background: "#f5f5f5", borderRight: "1px solid #e5e5e5" }}>
                <div className="theme-preview-sidebar-item" style={{ background: "#e0e0e0" }} />
                <div className="theme-preview-sidebar-item" style={{ background: "#e0e0e0" }} />
              </div>
              <div className="theme-preview-editor" style={{ background: "#ffffff" }}>
                <div className="theme-preview-heading" style={{ color: "#1a1a1a", fontSize: 7 }}>Aa</div>
              </div>
            </div>
            <div className="theme-preview-half" style={{ background: "#1a1a2e" }}>
              <div className="theme-preview-sidebar" style={{ background: "#16213e", borderRight: "1px solid #2a2a4a" }}>
                <div className="theme-preview-sidebar-item" style={{ background: "#2a2a4a" }} />
                <div className="theme-preview-sidebar-item" style={{ background: "#2a2a4a" }} />
              </div>
              <div className="theme-preview-editor" style={{ background: "#1a1a2e" }}>
                <div className="theme-preview-heading" style={{ color: "#e2e8f0", fontSize: 7 }}>Aa</div>
              </div>
            </div>
          </div>
          <span className="theme-card-name">{t("settings.appearance.systemAuto")}</span>
        </button>

        {/* All themes */}
        {allThemes.map((theme) => (
          <button
            key={theme.id}
            className={`theme-card ${activeThemeId === theme.id ? "theme-card-active" : ""}`}
            onClick={() => setActiveTheme(theme.id)}
            style={
              activeThemeId === theme.id
                ? { borderColor: theme.colors["--color-accent"] }
                : undefined
            }
          >
            <ThemeMiniPreview theme={theme} />
            <span className="theme-card-name">{theme.name}</span>
            {!theme.builtIn && <span className="theme-card-badge">{t("settings.appearance.customBadge")}</span>}
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
        <button className="theme-action-btn" onClick={() => setEditingTheme(true)}>
          {t("settings.appearance.customize")}
        </button>
        <button className="theme-action-btn" onClick={handleImport}>
          {t("settings.appearance.import")}
        </button>
      </div>

      <SettingsSectionHeader title={t("settings.appearance.workspacePresets")} />
      <WorkspaceSection />
    </div>
  );
}

// ─── Workspace Section (merged from WorkspaceTab) ────────

function workspaceLayoutSummary(preset: WorkspacePreset, t: (key: string) => string): string {
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

function WorkspaceSection() {
  const { t } = useTranslation();
  const { activePresetId, customPresets, applyPreset, saveCustomPreset, deleteCustomPreset } =
    useWorkspaceStore();

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
            key={preset.id}
            preset={preset}
            isActive={activePresetId === preset.id}
            onApply={handleApply}
            onDelete={!preset.builtIn ? deleteCustomPreset : undefined}
          />
        ))}
      </div>

      <div className="workspace-actions">
        {savingNew ? (
          <div className="workspace-save-form">
            <input
              type="text"
              className="workspace-save-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleSaveKeyDown}
              placeholder={t("settings.workspace.presetName")}
              autoFocus
            />
            <button
              className="workspace-save-confirm"
              onClick={handleSave}
              disabled={!newName.trim()}
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
          <button className="workspace-action-btn" onClick={() => setSavingNew(true)}>
            {t("settings.appearance.saveCurrentLayout")}
          </button>
        )}
      </div>
    </>
  );
}

function PresetCard({
  preset,
  isActive,
  onApply,
  onDelete,
}: {
  preset: WorkspacePreset;
  isActive: boolean;
  onApply: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`workspace-card ${isActive ? "workspace-card-active" : ""}`}
      onClick={() => onApply(preset.id)}
    >
      {isActive && <span className="workspace-card-check" aria-label="Active">&#10003;</span>}
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
        {preset.builtIn ? t(`settings.workspace.preset.${preset.id}`) : preset.name}
      </span>
      {preset.description && (
        <span className="workspace-card-desc">
          {preset.builtIn ? t(`settings.workspace.preset.${preset.id}.desc`) : preset.description}
        </span>
      )}
      <span className="workspace-card-summary">{workspaceLayoutSummary(preset, t)}</span>

      {preset.builtIn && <span className="workspace-card-badge">{t("settings.workspace.builtIn")}</span>}
    </div>
  );
}

function LayoutDiagram({ preset }: { preset: WorkspacePreset }) {
  const { layout } = preset;
  return (
    <div className="workspace-diagram">
      {layout.sidebarOpen && <div className="workspace-diagram-panel workspace-diagram-sidebar" />}
      <div className="workspace-diagram-panel workspace-diagram-editor" />
      {layout.rightPanelOpen && layout.rightPanelMode !== "none" && (
        <div className="workspace-diagram-panel workspace-diagram-right" />
      )}
    </div>
  );
}

// ─── Markdown Tab ───────────────────────────────────────

function MarkdownTab() {
  const { t } = useTranslation();
  const {
    inlineMath, setInlineMath,
    highlight, setHighlight,
    strikethrough, setStrikethrough,
    smartPunctuation, setSmartPunctuation,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.markdown.extendedSyntax")} />

      <SettingsRow label={t("settings.markdown.inlineMath")} description={t("settings.markdown.inlineMath.desc")}>
        <ToggleSwitch checked={inlineMath} onChange={setInlineMath} />
      </SettingsRow>

      <SettingsRow label={t("settings.markdown.highlight")} description={t("settings.markdown.highlight.desc")}>
        <ToggleSwitch checked={highlight} onChange={setHighlight} />
      </SettingsRow>

      <SettingsRow label={t("settings.markdown.strikethrough")} description={t("settings.markdown.strikethrough.desc")}>
        <ToggleSwitch checked={strikethrough} onChange={setStrikethrough} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.markdown.typography")} />

      <SettingsRow label={t("settings.markdown.smartPunctuation")} description={t("settings.markdown.smartPunctuation.desc")}>
        <ToggleSwitch checked={smartPunctuation} onChange={setSmartPunctuation} />
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

// ─── AI Tab ─────────────────────────────────────────────

function AITab() {
  const { t } = useTranslation();
  const {
    provider, setProvider,
    model, setModel,
    apiKey, setApiKey,
    ollamaUrl, setOllamaUrl,
    privacyMode, setPrivacyMode,
    ghostTextEnabled, setGhostTextEnabled,
    ghostTextDebounceMs, setGhostTextDebounceMs,
    maxSuggestionLength, setMaxSuggestionLength,
    keychainReady,
    autoModelEnabled, setAutoModelEnabled,
    modelForGhostText, modelForInlineEdit, modelForChat, modelForAgent,
    setModelForTask,
  } = useAIStore();
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);

  const handleProviderChange = useCallback(
    (newProvider: "claude" | "openai" | "ollama" | "gemini") => {
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
      const baseUrl = provider === "ollama" ? ollamaUrl || undefined : undefined;
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

      <SettingsRow label={t("settings.ai.aiProvider")} description={t("settings.ai.aiProvider.desc")}>
        <select
          className="settings-select"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as "claude" | "openai" | "ollama" | "gemini")}
        >
          <option value="claude">{t("settings.ai.provider.claude")}</option>
          <option value="openai">{t("settings.ai.provider.openai")}</option>
          <option value="gemini">{t("settings.ai.provider.gemini")}</option>
          <option value="ollama">{t("settings.ai.provider.ollama")}</option>
        </select>
      </SettingsRow>

      {showApiKey && (
        <SettingsRow
          label={t("settings.ai.apiKey")}
          description={keychainReady ? t("settings.ai.apiKey.desc.ready") : t("settings.ai.apiKey.desc.loading")}
        >
          <div className="settings-key-row">
            <input
              type={showKey ? "text" : "password"}
              className="settings-input settings-input-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keychainReady ? t("settings.ai.apiKey.placeholder") : t("settings.ai.apiKey.loading")}
              disabled={!keychainReady}
            />
            <button
              className="settings-key-toggle"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? t("settings.ai.apiKey.hide") : t("settings.ai.apiKey.show")}
            >
              {showKey ? t("settings.ai.apiKey.hide") : t("settings.ai.apiKey.show")}
            </button>
          </div>
        </SettingsRow>
      )}

      {provider === "ollama" && (
        <SettingsRow label={t("settings.ai.ollamaUrl")} description={t("settings.ai.ollamaUrl.desc")}>
          <input
            type="text"
            className="settings-input"
            value={ollamaUrl}
            onChange={(e) => setOllamaUrl(e.target.value)}
            placeholder={t("settings.ai.ollamaUrl.placeholder")}
          />
        </SettingsRow>
      )}

      <SettingsRow label={t("settings.ai.model")} description={t("settings.ai.model.desc")}>
        <div className="settings-model-row">
          {customMode || (models.length === 0 && !modelsLoading) ? (
            <input
              type="text"
              className="settings-input settings-input-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t("settings.ai.model.placeholder")}
            />
          ) : (
            <select
              className="settings-select settings-select-model"
              value={model}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setCustomMode(true);
                } else {
                  setModel(e.target.value);
                }
              }}
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
            onClick={fetchModels}
            disabled={!canFetchModels || modelsLoading}
            title={!canFetchModels ? t("settings.ai.model.keyFirst") : t("settings.ai.model.fetchTooltip")}
          >
            {modelsLoading ? (
              <span className="settings-model-spinner" />
            ) : (
              "\u21BB"
            )}
          </button>
        </div>
      </SettingsRow>

      {modelsError && (() => {
        const formatted = formatAIError(modelsError);
        return (
          <div className="settings-model-error">
            <strong>{formatted.title}</strong>
            <span>{formatted.detail}</span>
          </div>
        );
      })()}

      <SettingsSectionHeader title={t("settings.ai.modelSelection")} />

      <SettingsRow label={t("settings.ai.autoModel")} description={t("settings.ai.autoModel.desc")}>
        <ToggleSwitch checked={autoModelEnabled} onChange={setAutoModelEnabled} />
      </SettingsRow>

      {autoModelEnabled && (
        <>
          <SettingsRow label={t("settings.ai.ghostTextModel")} description={t("settings.ai.ghostTextModel.desc")}>
            <input
              type="text"
              className="settings-input"
              value={modelForGhostText}
              onChange={(e) => setModelForTask("ghost-text", e.target.value)}
              placeholder={model}
            />
          </SettingsRow>
          <SettingsRow label={t("settings.ai.inlineEditModel")} description={t("settings.ai.inlineEditModel.desc")}>
            <input
              type="text"
              className="settings-input"
              value={modelForInlineEdit}
              onChange={(e) => setModelForTask("inline-edit", e.target.value)}
              placeholder={model}
            />
          </SettingsRow>
          <SettingsRow label={t("settings.ai.chatModel")} description={t("settings.ai.chatModel.desc")}>
            <input
              type="text"
              className="settings-input"
              value={modelForChat}
              onChange={(e) => setModelForTask("chat", e.target.value)}
              placeholder={model}
            />
          </SettingsRow>
          <SettingsRow label={t("settings.ai.agentModel")} description={t("settings.ai.agentModel.desc")}>
            <input
              type="text"
              className="settings-input"
              value={modelForAgent}
              onChange={(e) => setModelForTask("agent", e.target.value)}
              placeholder={model}
            />
          </SettingsRow>
        </>
      )}

      <SettingsSectionHeader title={t("settings.ai.privacy")} />

      <SettingsRow label={t("settings.ai.privacyMode")} description={t("settings.ai.privacyMode.desc")}>
        <ToggleSwitch checked={privacyMode} onChange={setPrivacyMode} />
      </SettingsRow>

      <SettingsSectionHeader title={t("settings.ai.ghostText")} />

      <SettingsRow label={t("settings.ai.ghostTextEnabled")} description={t("settings.ai.ghostTextEnabled.desc")}>
        <ToggleSwitch checked={ghostTextEnabled} onChange={setGhostTextEnabled} />
      </SettingsRow>

      {ghostTextEnabled && (
        <>
          <SettingsRow label={t("settings.ai.debounce")} description={t("settings.ai.debounce.desc").replace("{value}", String(ghostTextDebounceMs))}>
            <input
              type="range"
              className="settings-range"
              min={200}
              max={2000}
              step={100}
              value={ghostTextDebounceMs}
              onChange={(e) => setGhostTextDebounceMs(Number(e.target.value))}
            />
          </SettingsRow>

          <SettingsRow label={t("settings.ai.maxLength")} description={t("settings.ai.maxLength.desc").replace("{value}", String(maxSuggestionLength))}>
            <input
              type="range"
              className="settings-range"
              min={20}
              max={500}
              step={10}
              value={maxSuggestionLength}
              onChange={(e) => setMaxSuggestionLength(Number(e.target.value))}
            />
          </SettingsRow>
        </>
      )}

      <SettingsSectionHeader title={t("settings.ai.customCommands")} />
      <CustomAICommandEditor />
    </div>
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

function FontFamilyPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = search
    ? FONT_OPTIONS.filter((f) => f.label.toLowerCase().includes(search.toLowerCase()))
    : FONT_OPTIONS;

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
        type="text"
        className="settings-input"
        value={open ? search : value}
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
      />
      {open && (
        <div className="settings-font-dropdown">
          {filtered.map((font) => (
            <button
              key={font.value}
              className={`settings-font-option ${font.value === value ? "settings-font-option-active" : ""}`}
              style={{ fontFamily: font.value }}
              onClick={() => handleSelect(font.value)}
            >
              {font.value === "system-ui" ? t("settings.editor.fontPicker.systemDefault") : font.label}
            </button>
          ))}
          {filtered.length === 0 && search && (
            <button
              className="settings-font-option"
              onClick={() => handleSelect(search)}
            >
              {t("settings.editor.fontPicker.useCustom").replace("{font}", search)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Extension Settings Helpers (merged from ExtensionsTab) ──

interface SettingOption { value: string; label: string; }
interface SettingDef {
  key: string;
  type: "boolean" | "select" | "number" | "string";
  label: string;
  description: string;
  default: unknown;
  options?: SettingOption[];
  min?: number; max?: number; step?: number;
  placeholder?: string;
}
interface RegistryEntry { name: string; settings?: SettingDef[]; }

function getExtensionsWithSettings() {
  const allEntries: RegistryEntry[] = [
    ...(registry.nodes as RegistryEntry[]),
    ...(registry.marks as RegistryEntry[]),
    ...(registry.plugins as RegistryEntry[]),
  ];
  return allEntries
    .filter((e): e is RegistryEntry & { settings: SettingDef[] } =>
      Array.isArray(e.settings) && e.settings.length > 0)
    .map((e) => ({ name: e.name, settings: e.settings }));
}

function formatExtName(name: string): string {
  const spaced = name.replace(/([A-Z])/g, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ExtensionSettingRow({ setting }: { setting: SettingDef }) {
  const { extensionSettings, setExtensionSetting } = useSettingsStore();
  const value = extensionSettings[setting.key] ?? setting.default;
  switch (setting.type) {
    case "boolean":
      return (
        <SettingsRow label={setting.label} description={setting.description}>
          <ToggleSwitch checked={!!value} onChange={(v) => setExtensionSetting(setting.key, v)} />
        </SettingsRow>
      );
    case "select":
      return (
        <SettingsRow label={setting.label} description={setting.description}>
          <select className="settings-select" value={value as string}
            onChange={(e) => setExtensionSetting(setting.key, e.target.value)}>
            {(setting.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </SettingsRow>
      );
    case "number":
      return (
        <SettingsRow label={setting.label} description={`${setting.description} (${value})`}>
          <input type="range" className="settings-range"
            min={setting.min ?? 0} max={setting.max ?? 100} step={setting.step ?? 1}
            value={value as number}
            onChange={(e) => setExtensionSetting(setting.key, Number(e.target.value))} />
        </SettingsRow>
      );
    case "string":
      return (
        <SettingsRow label={setting.label} description={setting.description}>
          <input type="text" className="settings-input" value={value as string}
            onChange={(e) => setExtensionSetting(setting.key, e.target.value)}
            placeholder={setting.placeholder ?? ""} />
        </SettingsRow>
      );
    default:
      return null;
  }
}

// ─── Shared Components ──────────────────────────────────

function ThemeMiniPreview({ theme }: { theme: ThemeDef }) {
  const c = theme.colors;
  return (
    <div className="theme-preview" style={{ background: c["--color-bg-primary"] }}>
      <div
        className="theme-preview-sidebar"
        style={{
          background: c["--color-bg-sidebar"],
          borderRight: `1px solid ${c["--color-border"]}`,
        }}
      >
        <div className="theme-preview-sidebar-item" style={{ background: c["--color-bg-tertiary"] }} />
        <div className="theme-preview-sidebar-item" style={{ background: c["--color-bg-tertiary"] }} />
        <div className="theme-preview-sidebar-item" style={{ background: c["--color-bg-tertiary"] }} />
      </div>
      <div className="theme-preview-editor" style={{ background: c["--color-editor-bg"] }}>
        <div className="theme-preview-heading" style={{ color: c["--color-editor-text"] }}>
          Heading
        </div>
        <div className="theme-preview-text" style={{ color: c["--color-editor-text"] }}>
          Some <span style={{ color: c["--color-accent"], fontWeight: 600 }}>bold</span> text
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

function ActivityBarTab() {
  const { activityBarConfig, setActivityBarConfig, resetActivityBarConfig } = useSettingsStore();
  const { t } = useTranslation();

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragRef = useRef<{ id: string; section: string } | null>(null);
  const dropRef = useRef<{ id: string; position: "before" | "after" } | null>(null);
  const configRef = useRef(activityBarConfig);
  configRef.current = activityBarConfig;

  const topItems = activityBarConfig.filter((i) => i.section === "top");
  const bottomItems = activityBarConfig.filter((i) => i.section === "bottom");

  const toggleItem = (id: string) => {
    setActivityBarConfig(
      activityBarConfig.map((item) =>
        item.id === id ? { ...item, visible: !item.visible } : item
      )
    );
  };

  const onPointerDown = useCallback((id: string, section: string, e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { id, section };
    setDraggingId(id);

    const onMove = (moveE: PointerEvent) => {
      const state = dragRef.current;
      if (!state) return;

      let closestId: string | null = null;
      let closestPos: "before" | "after" = "before";
      let closestDist = Infinity;

      for (const [rowId, el] of rowRefs.current.entries()) {
        const rowItem = configRef.current.find(i => i.id === rowId);
        if (!rowItem || rowItem.section !== state.section || rowId === state.id) continue;

        const rect = el.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const dist = Math.abs(moveE.clientY - midY);

        if (dist < closestDist) {
          closestDist = dist;
          closestId = rowId;
          closestPos = moveE.clientY < midY ? "before" : "after";
        }
      }

      dropRef.current = closestId ? { id: closestId, position: closestPos } : null;
      setDropIndicator(dropRef.current);
    };

    const onUp = () => {
      const state = dragRef.current;
      const drop = dropRef.current;

      if (state && drop && state.id !== drop.id) {
        const config = [...configRef.current];
        const fromIdx = config.findIndex(i => i.id === state.id);
        if (fromIdx !== -1) {
          const [item] = config.splice(fromIdx, 1);
          let toIdx = config.findIndex(i => i.id === drop.id);
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
  }, [setActivityBarConfig]);

  const setRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const renderSection = (title: string, items: ActivityBarItemConfig[]) => (
    <>
      <SettingsSectionHeader title={title} />
      {items.map((item) => (
        <div
          key={item.id}
          ref={(el) => setRowRef(item.id, el)}
          className={`settings-row activity-bar-config-row${
            draggingId === item.id ? " activity-bar-dragging" : ""
          }${
            dropIndicator?.id === item.id
              ? ` activity-bar-drop-${dropIndicator.position}`
              : ""
          }`}
        >
          <div className="activity-bar-config-left">
            <div
              className="activity-bar-config-drag-handle"
              onPointerDown={(e) => onPointerDown(item.id, item.section, e)}
            >
              {"\u2807"}
            </div>
            <span className={`settings-row-label ${!item.visible ? "activity-bar-config-hidden" : ""}`}>
              {t(`settings.activitybar.item.${item.id}`)}
            </span>
          </div>
          <div className="settings-row-control">
            <ToggleSwitch checked={item.visible} onChange={() => toggleItem(item.id)} />
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

// ─── Language Tab ──────────────────────────────────────

function LanguageTab() {
  const { locale, setLocale } = useSettingsStore();
  const { t } = useTranslation();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.language.title")} />

      <SettingsRow
        label={t("settings.language.interface")}
        description={t("settings.language.interface.desc")}
      >
        <select
          className="settings-select"
          value={locale}
          onChange={(e) => setLocale(e.target.value)}
        >
          {AVAILABLE_LOCALES.map((loc: Locale) => (
            <option key={loc} value={loc}>
              {LOCALE_LABELS[loc]}
            </option>
          ))}
        </select>
      </SettingsRow>

      <div className="settings-row-description" style={{ marginTop: 12, fontStyle: "italic" }}>
        {t("settings.language.reloadNotice")}
      </div>
    </div>
  );
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
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [capturedKey, setCapturedKey] = useState<string | null>(null);
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

      if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return;

      const normalized = normalizeKeyEvent(e, isMac);
      if (!normalized) return;

      setCapturedKey(normalized);
      const conflicting = findConflict(capturingId, normalized, keybindingOverrides);
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
          type="text"
          placeholder={t("keybindings.search.placeholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="settings-search-input"
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
              key={entry.id}
              className={`keybinding-row${entry.isOverridden ? " keybinding-overridden" : ""}${!entry.customizable ? " keybinding-readonly-row" : ""}`}
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
                            {t("keybindings.conflict").replace("{command}", t(conflict.label))}
                          </span>
                        )}
                        <button className="keybinding-confirm-btn" onClick={confirmCapture}>
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

function SettingsSectionHeader({ title }: { title: string }) {
  return <div className="settings-section-header">{title}</div>;
}

function SettingsSearchResults({
  grouped,
  query,
  onNavigate,
}: {
  grouped: Map<SettingsTab, SearchableSetting[]> | null;
  query: string;
  onNavigate: (tab: SettingsTab) => void;
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
            <div key={item.id} className="settings-search-result-row">
              <div className="settings-row-info">
                <span className="settings-row-label">{t(item.label)}</span>
                <span className="settings-row-description">
                  {t(item.section)} &middot; {t(item.description)}
                </span>
              </div>
              <div className="settings-row-control">
                <SearchSettingControl id={item.id} onNavigate={() => onNavigate(category)} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Renders the actual control for a setting in search results. */
function SearchSettingControl({ id, onNavigate }: { id: string; onNavigate: () => void }) {
  const { t } = useTranslation();
  const settings = useSettingsStore();
  const ai = useAIStore();

  switch (id) {
    // ── General toggles ──
    case "autoSave":
      return <ToggleSwitch checked={settings.autoSave} onChange={settings.setAutoSave} />;
    case "showWelcome":
      return <ToggleSwitch checked={settings.showWelcome} onChange={settings.setShowWelcome} />;
    case "spellCheck":
      return <ToggleSwitch checked={settings.spellCheck} onChange={settings.setSpellCheck} />;
    case "autoUpdateLinks":
      return <ToggleSwitch checked={settings.autoUpdateLinks} onChange={settings.setAutoUpdateLinks} />;
    case "journalEnabled":
      return <ToggleSwitch checked={settings.journalEnabled} onChange={settings.setJournalEnabled} />;

    // ── General selects ──
    case "onLaunch":
      return (
        <select className="settings-select" value={settings.onLaunch}
          onChange={(e) => settings.setOnLaunch(e.target.value as "newFile" | "restoreLastFolder" | "restoreLastFile")}>
          <option value="restoreLastFolder">{t("settings.general.onLaunch.restoreLastFolder")}</option>
          <option value="restoreLastFile">{t("settings.general.onLaunch.restoreLastFile")}</option>
          <option value="newFile">{t("settings.general.onLaunch.newFile")}</option>
        </select>
      );
    case "wikilinkFormat":
      return (
        <select className="settings-select" value={settings.wikilinkFormat}
          onChange={(e) => settings.setWikilinkFormat(e.target.value as "wikilink" | "markdown")}>
          <option value="wikilink">{"[[Wikilink]]"}</option>
          <option value="markdown">[Markdown](link)</option>
        </select>
      );

    // ── General ranges ──
    case "autoSaveDelay":
      return (
        <input type="range" className="settings-range" min={500} max={10000} step={500}
          value={settings.autoSaveDelay} onChange={(e) => settings.setAutoSaveDelay(Number(e.target.value))} />
      );
    case "snapshotInterval":
      return (
        <input type="range" className="settings-range" min={0} max={120} step={5}
          value={settings.snapshotInterval} onChange={(e) => settings.setSnapshotInterval(Number(e.target.value))} />
      );
    case "snapshotMaxCount":
      return (
        <input type="range" className="settings-range" min={5} max={200} step={5}
          value={settings.snapshotMaxCount} onChange={(e) => settings.setSnapshotMaxCount(Number(e.target.value))} />
      );

    // ── Editor ranges ──
    case "fontSize":
      return (
        <input type="range" className="settings-range" min={8} max={32} step={1}
          value={settings.fontSize} onChange={(e) => settings.setFontSize(Number(e.target.value))} />
      );
    case "lineHeight":
      return (
        <input type="range" className="settings-range" min={1.0} max={3.0} step={0.05}
          value={settings.lineHeight} onChange={(e) => settings.setLineHeight(Number(e.target.value))} />
      );
    case "editorMaxWidth":
      return (
        <input type="range" className="settings-range" min={0} max={2048} step={50}
          value={settings.editorMaxWidth} onChange={(e) => settings.setEditorMaxWidth(Number(e.target.value))} />
      );

    // ── Editor toggles ──
    case "lineNumbers":
      return <ToggleSwitch checked={settings.lineNumbers} onChange={settings.setLineNumbers} />;
    case "autoPairBrackets":
      return <ToggleSwitch checked={settings.autoPairBrackets} onChange={settings.setAutoPairBrackets} />;

    // ── Editor selects ──
    case "tabSize":
      return (
        <select className="settings-select" value={settings.tabSize}
          onChange={(e) => settings.setTabSize(Number(e.target.value))}>
          <option value={2}>{t("settings.editor.tabSize.2spaces")}</option>
          <option value={4}>{t("settings.editor.tabSize.4spaces")}</option>
        </select>
      );

    // ── Markdown toggles ──
    case "inlineMath":
      return <ToggleSwitch checked={settings.inlineMath} onChange={settings.setInlineMath} />;
    case "highlight":
      return <ToggleSwitch checked={settings.highlight} onChange={settings.setHighlight} />;
    case "strikethrough":
      return <ToggleSwitch checked={settings.strikethrough} onChange={settings.setStrikethrough} />;
    case "smartPunctuation":
      return <ToggleSwitch checked={settings.smartPunctuation} onChange={settings.setSmartPunctuation} />;

    // ── AI toggles ──
    case "ghostTextEnabled":
      return <ToggleSwitch checked={ai.ghostTextEnabled} onChange={ai.setGhostTextEnabled} />;
    case "privacyMode":
      return <ToggleSwitch checked={ai.privacyMode} onChange={ai.setPrivacyMode} />;

    // ── AI selects ──
    case "provider":
      return (
        <select className="settings-select" value={ai.provider}
          onChange={(e) => ai.setProvider(e.target.value as "claude" | "openai" | "ollama" | "gemini")}>
          <option value="claude">{t("settings.ai.provider.claude")}</option>
          <option value="openai">{t("settings.ai.provider.openai")}</option>
          <option value="gemini">{t("settings.ai.provider.gemini")}</option>
          <option value="ollama">{t("settings.ai.provider.ollama")}</option>
        </select>
      );

    // ── Language ──
    case "locale":
      return (
        <select className="settings-select" value={settings.locale}
          onChange={(e) => settings.setLocale(e.target.value)}>
          {AVAILABLE_LOCALES.map((loc) => (
            <option key={loc} value={loc}>{LOCALE_LABELS[loc]}</option>
          ))}
        </select>
      );

    // ── Complex settings: navigate to tab ──
    case "fontFamily":
    case "activeThemeId":
    case "activityBarConfig":
    case "apiKey":
    case "model":
      return (
        <button className="theme-action-btn" onClick={onNavigate}>
          {t("settings.search.open")}
        </button>
      );
    case "keybindings":
      return (
        <button className="settings-btn" onClick={onNavigate}>
          {t("settings.search.open")}
        </button>
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
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-info">
        <span className="settings-row-label">{label}</span>
        {description && <span className="settings-row-description">{description}</span>}
      </div>
      <div className="settings-row-control">{children}</div>
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
      className={`settings-toggle ${checked ? "settings-toggle-on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

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

type SettingsTab = "general" | "editor" | "appearance" | "markdown" | "ai" | "activitybar" | "language";

const TABS: { id: SettingsTab; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "\u2699" },
  { id: "editor", label: "Editor", icon: "\u270E" },
  { id: "appearance", label: "Appearance", icon: "\u25D1" },
  { id: "markdown", label: "Markdown", icon: "M\u2193" },
  { id: "ai", label: "AI", icon: "\u2726" },
  { id: "activitybar", label: "Activity Bar", icon: "\u25A4" },
  { id: "language", label: "Language", icon: "\uD83C\uDF10" },
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
  { id: "onLaunch", label: "On Launch", description: "What to do when Baram starts", category: "general", section: "Startup" },
  { id: "showWelcome", label: "Show Welcome", description: "Show the welcome screen on startup", category: "general", section: "Startup" },
  { id: "autoSave", label: "Auto Save", description: "Automatically save changes after editing", category: "general", section: "Saving" },
  { id: "autoSaveDelay", label: "Save Delay", description: "Wait before saving", category: "general", section: "Saving" },
  { id: "spellCheck", label: "Spell Check", description: "Check spelling while typing", category: "general", section: "System" },
  { id: "wikilinkFormat", label: "Internal Link Format", description: "How internal links are written in Markdown", category: "general", section: "Links", keywords: ["wikilink", "markdown", "link"] },
  { id: "autoUpdateLinks", label: "Auto-update Links", description: "Update internal links when a file is renamed", category: "general", section: "Links" },
  { id: "snapshotInterval", label: "Snapshot Interval", description: "Auto-snapshot interval in minutes", category: "general", section: "Snapshots", keywords: ["version", "history", "backup"] },
  { id: "snapshotMaxCount", label: "Max Snapshots", description: "Maximum snapshots per file", category: "general", section: "Snapshots" },
  { id: "journalEnabled", label: "Enable Journal", description: "Create daily notes in a journal folder", category: "general", section: "Journal", keywords: ["daily", "note", "diary"] },
  // Editor
  { id: "fontFamily", label: "Font Family", description: "Typeface used in the editor", category: "editor", section: "Font", keywords: ["typeface", "font"] },
  { id: "fontSize", label: "Font Size", description: "Size of text in the editor", category: "editor", section: "Font" },
  { id: "lineHeight", label: "Line Height", description: "Spacing between lines", category: "editor", section: "Font" },
  { id: "tabSize", label: "Tab Size", description: "Spaces per tab in source mode and code blocks", category: "editor", section: "Behavior", keywords: ["indent", "space"] },
  { id: "autoPairBrackets", label: "Auto Pair Brackets", description: "Auto-close brackets and quotes", category: "editor", section: "Behavior" },
  { id: "lineNumbers", label: "Line Numbers", description: "Show line numbers in source mode", category: "editor", section: "Display" },
  { id: "editorMaxWidth", label: "Editor Max Width", description: "Maximum content width", category: "editor", section: "Display" },
  // Appearance
  { id: "activeThemeId", label: "Theme", description: "Color theme for the editor", category: "appearance", section: "Theme", keywords: ["dark", "light", "color", "theme"] },
  // Markdown
  { id: "inlineMath", label: "Inline Math", description: "Enable $...$ and $$...$$ math expressions", category: "markdown", section: "Extended Syntax", keywords: ["katex", "latex", "equation"] },
  { id: "highlight", label: "Highlight", description: "Enable ==highlight== syntax", category: "markdown", section: "Extended Syntax" },
  { id: "strikethrough", label: "Strikethrough", description: "Enable ~~strikethrough~~ syntax", category: "markdown", section: "Extended Syntax" },
  { id: "smartPunctuation", label: "Smart Punctuation", description: "Convert straight quotes and dashes to typographic equivalents", category: "markdown", section: "Typography" },
  // AI
  { id: "provider", label: "AI Provider", description: "Choose the AI service for completions", category: "ai", section: "Provider", keywords: ["claude", "openai", "ollama", "gemini"] },
  { id: "apiKey", label: "API Key", description: "API key for AI provider", category: "ai", section: "Provider" },
  { id: "model", label: "Model", description: "Model name or ID to use for AI requests", category: "ai", section: "Provider" },
  { id: "ghostTextEnabled", label: "Ghost Text", description: "Show inline text completion suggestions while typing", category: "ai", section: "Ghost Text", keywords: ["autocomplete", "suggestion"] },
  { id: "privacyMode", label: "Privacy Mode", description: "Do not send document content to AI providers", category: "ai", section: "Privacy" },
  // Activity Bar
  { id: "activityBarConfig", label: "Activity Bar", description: "Show, hide, and reorder Activity Bar icons", category: "activitybar", section: "Activity Bar", keywords: ["icon", "sidebar", "panel"] },
  // Language
  { id: "locale", label: "Language", description: "Interface language", category: "language", section: "Language", keywords: ["locale", "i18n", "korean", "english", "\uD55C\uAD6D\uC5B4"] },
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
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.section.toLowerCase().includes(q) ||
        (s.keywords ?? []).some((k) => k.includes(q))
    );
  }, [searchQuery]);

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
          <button className="settings-close" onClick={toggleSettings} title="Close">
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
      <SettingsSectionHeader title="Startup" />

      <SettingsRow label="On Launch" description="What to do when Baram starts">
        <select
          className="settings-select"
          value={onLaunch}
          onChange={(e) => setOnLaunch(e.target.value as "newFile" | "restoreLastFolder" | "restoreLastFile")}
        >
          <option value="restoreLastFolder">Restore last folder</option>
          <option value="restoreLastFile">Restore last file</option>
          <option value="newFile">New file</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Show Welcome" description="Show the welcome screen on startup">
        <ToggleSwitch checked={showWelcome} onChange={setShowWelcome} />
      </SettingsRow>

      <SettingsSectionHeader title="Saving" />

      <SettingsRow label="Auto Save" description="Automatically save changes after editing">
        <ToggleSwitch checked={autoSave} onChange={setAutoSave} />
      </SettingsRow>

      {autoSave && (
        <SettingsRow label="Save Delay" description={`Wait before saving (${(autoSaveDelay / 1000).toFixed(1)}s)`}>
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

      <SettingsSectionHeader title="System" />

      <SettingsRow label="Spell Check" description="Check spelling while typing">
        <ToggleSwitch checked={spellCheck} onChange={setSpellCheck} />
      </SettingsRow>

      <SettingsSectionHeader title="Links" />

      <SettingsRow label="Internal Link Format" description="How internal links are written in Markdown">
        <select
          className="settings-select"
          value={wikilinkFormat}
          onChange={(e) => setWikilinkFormat(e.target.value as "wikilink" | "markdown")}
        >
          <option value="wikilink">[[Wikilink]]</option>
          <option value="markdown">[Markdown](link)</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Auto-update Links" description="Update internal links when a file is renamed">
        <ToggleSwitch checked={autoUpdateLinks} onChange={setAutoUpdateLinks} />
      </SettingsRow>

      <SettingsSectionHeader title="Snapshots" />

      <SettingsRow label="Snapshot Interval" description={`Auto-snapshot every ${snapshotInterval} minutes (0 = disabled)`}>
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

      <SettingsRow label="Max Snapshots" description={`Keep up to ${snapshotMaxCount} snapshots per file`}>
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

      <SettingsSectionHeader title="Journal" />

      <SettingsRow label="Enable Journal" description="Create daily notes in a journal folder">
        <ToggleSwitch checked={journalEnabled} onChange={setJournalEnabled} />
      </SettingsRow>

      {journalEnabled && (
        <>
          <SettingsRow label="Journal Directory" description="Absolute path for daily notes (e.g. /Users/me/journals)">
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalDirectory}
                readOnly
                placeholder="Select a folder…"
              />
              <button
                className="settings-key-toggle"
                onClick={async () => {
                  const selected = await open({ directory: true });
                  if (selected) setJournalDirectory(selected);
                }}
              >
                Browse
              </button>
            </div>
          </SettingsRow>

          <SettingsRow label="Filename Format" description="Date format for journal filenames">
            <select
              className="settings-select"
              value={journalFilenameFormat}
              onChange={(e) => setJournalFilenameFormat(e.target.value)}
            >
              <option value="YYYY-MM-DD.md">YYYY-MM-DD.md</option>
              <option value="YYYYMMDD.md">YYYYMMDD.md</option>
            </select>
          </SettingsRow>

          <SettingsRow label="Template" description="Custom template file for new journal entries">
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalTemplatePath}
                readOnly
                placeholder="None (use default)"
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
                Browse
              </button>
              {journalTemplatePath && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalTemplatePath("")}
                >
                  Clear
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow label="On Startup" description="Action when opening a workspace with journal enabled">
            <select
              className="settings-select"
              value={journalStartupBehavior}
              onChange={(e) => setJournalStartupBehavior(e.target.value as "openJournal" | "nothing")}
            >
              <option value="openJournal">Open today's journal</option>
              <option value="nothing">Do nothing</option>
            </select>
          </SettingsRow>

          <SettingsRow label="Hierarchical Folders" description="Organize daily notes into daily/YYYY/MM/ subfolders">
            <ToggleSwitch
              checked={journalUseHierarchy}
              onChange={setJournalUseHierarchy}
            />
          </SettingsRow>

          {journalDirectory && (
            <SettingsRow label="Migrate Existing Files" description="Move flat YYYY-MM-DD.md files into the hierarchical structure">
              <button
                className="settings-key-toggle"
                onClick={() => setMigrationOpen(true)}
              >
                Migrate files...
              </button>
            </SettingsRow>
          )}

          <SettingsSectionHeader title="Periodic Note Templates" />

          <SettingsRow label="Weekly Template" description="Custom template file for new weekly notes">
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalWeeklyTemplate}
                readOnly
                placeholder="None (use default)"
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
                Browse
              </button>
              {journalWeeklyTemplate && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalWeeklyTemplate("")}
                >
                  Clear
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow label="Monthly Template" description="Custom template file for new monthly notes">
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalMonthlyTemplate}
                readOnly
                placeholder="None (use default)"
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
                Browse
              </button>
              {journalMonthlyTemplate && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalMonthlyTemplate("")}
                >
                  Clear
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsRow label="Yearly Template" description="Custom template file for new yearly notes">
            <div className="settings-key-row">
              <input
                type="text"
                className="settings-input settings-input-key"
                value={journalYearlyTemplate}
                readOnly
                placeholder="None (use default)"
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
                Browse
              </button>
              {journalYearlyTemplate && (
                <button
                  className="settings-key-toggle"
                  onClick={() => setJournalYearlyTemplate("")}
                >
                  Clear
                </button>
              )}
            </div>
          </SettingsRow>

          <SettingsSectionHeader title="AI" />

          <SettingsRow label="AI Follow-Up Questions" description="Automatically suggest deeper questions after writing (requires LLM)">
            <ToggleSwitch
              checked={useSettingsStore.getState().journalAIAutoSuggest}
              onChange={(v) => useSettingsStore.getState().setJournalAIAutoSuggest(v)}
            />
          </SettingsRow>

          {journalDirectory && (
            <SettingsRow
              label="Create Template Files"
              description={`Create starter templates in ${journalDirectory}/templates/`}
            >
              <div className="settings-key-row">
                <button
                  className="settings-key-toggle"
                  onClick={async () => {
                    try {
                      await initJournalTemplatesDir(journalDirectory);
                      setTemplatesInitMsg("Templates created successfully.");
                    } catch {
                      setTemplatesInitMsg("Failed to create templates.");
                    }
                    setTimeout(() => setTemplatesInitMsg(null), 3000);
                  }}
                >
                  Create template files
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
      <SettingsSectionHeader title="Font" />

      <SettingsRow label="Font Family" description="Typeface used in the editor">
        <FontFamilyPicker value={fontFamily} onChange={setFontFamily} />
      </SettingsRow>

      <SettingsRow label="Font Size" description={`Size of text in the editor (${fontSize}px)`}>
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

      <SettingsRow label="Line Height" description={`Spacing between lines (${lineHeight.toFixed(2)})`}>
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

      <SettingsSectionHeader title="Behavior" />

      <SettingsRow label="Tab Size" description="Spaces per tab in source mode and code blocks">
        <select
          className="settings-select"
          value={tabSize}
          onChange={(e) => setTabSize(Number(e.target.value))}
        >
          <option value={2}>2 spaces</option>
          <option value={4}>4 spaces</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Auto Pair Brackets" description="Auto-close brackets and quotes in source mode and code blocks">
        <ToggleSwitch checked={autoPairBrackets} onChange={setAutoPairBrackets} />
      </SettingsRow>

      <SettingsSectionHeader title="Display" />

      <SettingsRow label="Line Numbers" description="Show line numbers in source mode">
        <ToggleSwitch checked={lineNumbers} onChange={setLineNumbers} />
      </SettingsRow>

      <SettingsRow label="Editor Max Width" description={`Maximum content width (${editorMaxWidth === 0 ? "No limit" : editorMaxWidth + "px"})`}>
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
      <SettingsSectionHeader title="Theme" />

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
          <span className="theme-card-name">System (Auto)</span>
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
            {!theme.builtIn && <span className="theme-card-badge">Custom</span>}
            {!theme.builtIn && (
              <button
                className="theme-card-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteCustomTheme(theme.id);
                }}
                title="Delete theme"
              >
                {"\u00D7"}
              </button>
            )}
          </button>
        ))}
      </div>

      <div className="theme-actions">
        <button className="theme-action-btn" onClick={() => setEditingTheme(true)}>
          Customize...
        </button>
        <button className="theme-action-btn" onClick={handleImport}>
          Import Theme...
        </button>
      </div>

      <SettingsSectionHeader title="Workspace Presets" />
      <WorkspaceSection />
    </div>
  );
}

// ─── Workspace Section (merged from WorkspaceTab) ────────

const SIDEBAR_PANEL_LABELS: Record<string, string> = {
  files: "Files",
  outline: "Outline",
  search: "Search",
  backlinks: "Backlinks",
  bookmarks: "Bookmarks",
  graph: "Graph",
  git: "Git",
};

const RIGHT_PANEL_LABELS: Record<string, string> = {
  chat: "AI Chat",
  help: "Help",
  none: "None",
};

function workspaceLayoutSummary(preset: WorkspacePreset): string {
  const parts: string[] = [];
  if (preset.layout.sidebarOpen) {
    parts.push(SIDEBAR_PANEL_LABELS[preset.layout.sidebarPanel] ?? preset.layout.sidebarPanel);
  }
  parts.push("Editor");
  if (preset.layout.rightPanelOpen && preset.layout.rightPanelMode !== "none") {
    parts.push(RIGHT_PANEL_LABELS[preset.layout.rightPanelMode] ?? preset.layout.rightPanelMode);
  }
  return parts.join(" + ");
}

function WorkspaceSection() {
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
              placeholder="Preset name..."
              autoFocus
            />
            <button
              className="workspace-save-confirm"
              onClick={handleSave}
              disabled={!newName.trim()}
            >
              Save
            </button>
            <button
              className="workspace-save-cancel"
              onClick={() => {
                setNewName("");
                setSavingNew(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button className="workspace-action-btn" onClick={() => setSavingNew(true)}>
            Save Current Layout...
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
          title="Delete preset"
        >
          {"\u00D7"}
        </button>
      )}

      <div className="workspace-card-layout">
        <LayoutDiagram preset={preset} />
      </div>

      <span className="workspace-card-name">{preset.name}</span>
      {preset.description && (
        <span className="workspace-card-desc">{preset.description}</span>
      )}
      <span className="workspace-card-summary">{workspaceLayoutSummary(preset)}</span>

      {preset.builtIn && <span className="workspace-card-badge">Built-in</span>}
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
  const {
    inlineMath, setInlineMath,
    highlight, setHighlight,
    strikethrough, setStrikethrough,
    smartPunctuation, setSmartPunctuation,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title="Extended Syntax" />

      <SettingsRow label="Inline Math" description="Enable $...$ and $$...$$ math expressions">
        <ToggleSwitch checked={inlineMath} onChange={setInlineMath} />
      </SettingsRow>

      <SettingsRow label="Highlight" description="Enable ==highlight== syntax">
        <ToggleSwitch checked={highlight} onChange={setHighlight} />
      </SettingsRow>

      <SettingsRow label="Strikethrough" description="Enable ~~strikethrough~~ syntax">
        <ToggleSwitch checked={strikethrough} onChange={setStrikethrough} />
      </SettingsRow>

      <SettingsSectionHeader title="Typography" />

      <SettingsRow label="Smart Punctuation" description="Convert straight quotes and dashes to typographic equivalents">
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
      <SettingsSectionHeader title="Provider" />

      <SettingsRow label="AI Provider" description="Choose the AI service for completions">
        <select
          className="settings-select"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as "claude" | "openai" | "ollama" | "gemini")}
        >
          <option value="claude">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
          <option value="ollama">Ollama (Local)</option>
        </select>
      </SettingsRow>

      {showApiKey && (
        <SettingsRow
          label="API Key"
          description={keychainReady ? "Stored securely in OS Keychain" : "Loading from Keychain..."}
        >
          <div className="settings-key-row">
            <input
              type={showKey ? "text" : "password"}
              className="settings-input settings-input-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keychainReady ? "Enter API key..." : "Loading..."}
              disabled={!keychainReady}
            />
            <button
              className="settings-key-toggle"
              onClick={() => setShowKey((v) => !v)}
              title={showKey ? "Hide" : "Show"}
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
        </SettingsRow>
      )}

      {provider === "ollama" && (
        <SettingsRow label="Ollama URL" description="Base URL for the Ollama server">
          <input
            type="text"
            className="settings-input"
            value={ollamaUrl}
            onChange={(e) => setOllamaUrl(e.target.value)}
            placeholder="http://localhost:11434"
          />
        </SettingsRow>
      )}

      <SettingsRow label="Model" description="Model name or ID to use for requests">
        <div className="settings-model-row">
          {customMode || (models.length === 0 && !modelsLoading) ? (
            <input
              type="text"
              className="settings-input settings-input-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Enter model name..."
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
              <option value="__custom__">Custom...</option>
            </select>
          )}
          <button
            className="settings-model-refresh"
            onClick={fetchModels}
            disabled={!canFetchModels || modelsLoading}
            title={!canFetchModels ? "Enter API key first" : "Fetch available models"}
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

      <SettingsSectionHeader title="Model Selection" />

      <SettingsRow label="Auto Model Selection" description="Use different models for different AI tasks">
        <ToggleSwitch checked={autoModelEnabled} onChange={setAutoModelEnabled} />
      </SettingsRow>

      {autoModelEnabled && (
        <>
          <SettingsRow label="Ghost Text Model" description="Fast model for inline completions">
            <input
              type="text"
              className="settings-input"
              value={modelForGhostText}
              onChange={(e) => setModelForTask("ghost-text", e.target.value)}
              placeholder={model}
            />
          </SettingsRow>
          <SettingsRow label="Inline Edit Model" description="Model for Cmd+J rewriting">
            <input
              type="text"
              className="settings-input"
              value={modelForInlineEdit}
              onChange={(e) => setModelForTask("inline-edit", e.target.value)}
              placeholder={model}
            />
          </SettingsRow>
          <SettingsRow label="Chat Model" description="Model for AI chat conversations">
            <input
              type="text"
              className="settings-input"
              value={modelForChat}
              onChange={(e) => setModelForTask("chat", e.target.value)}
              placeholder={model}
            />
          </SettingsRow>
          <SettingsRow label="Agent Model" description="Model for autonomous AI tasks">
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

      <SettingsSectionHeader title="Privacy" />

      <SettingsRow label="Privacy Mode" description="Do not send document content to AI providers">
        <ToggleSwitch checked={privacyMode} onChange={setPrivacyMode} />
      </SettingsRow>

      <SettingsSectionHeader title="Ghost Text" />

      <SettingsRow label="Enable Ghost Text" description="Show inline text completion suggestions while typing">
        <ToggleSwitch checked={ghostTextEnabled} onChange={setGhostTextEnabled} />
      </SettingsRow>

      {ghostTextEnabled && (
        <>
          <SettingsRow label="Debounce" description={`Wait before requesting suggestion (${ghostTextDebounceMs}ms)`}>
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

          <SettingsRow label="Max Length" description={`Maximum suggestion length (${maxSuggestionLength} tokens)`}>
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

      <SettingsSectionHeader title="Custom Commands" />
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
        placeholder="Type or select a font..."
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
              {font.label}
            </button>
          ))}
          {filtered.length === 0 && search && (
            <button
              className="settings-font-option"
              onClick={() => handleSelect(search)}
            >
              Use "{search}"
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

  const topItems = activityBarConfig.filter((i) => i.section === "top");
  const bottomItems = activityBarConfig.filter((i) => i.section === "bottom");

  const toggleItem = (id: string) => {
    setActivityBarConfig(
      activityBarConfig.map((item) =>
        item.id === id ? { ...item, visible: !item.visible } : item
      )
    );
  };

  const moveItem = (id: string, direction: "up" | "down") => {
    const newConfig = [...activityBarConfig];
    const idx = newConfig.findIndex((item) => item.id === id);
    if (idx === -1) return;
    const item = newConfig[idx];

    if (direction === "up") {
      for (let i = idx - 1; i >= 0; i--) {
        if (newConfig[i].section === item.section) {
          [newConfig[idx], newConfig[i]] = [newConfig[i], newConfig[idx]];
          break;
        }
      }
    } else {
      for (let i = idx + 1; i < newConfig.length; i++) {
        if (newConfig[i].section === item.section) {
          [newConfig[idx], newConfig[i]] = [newConfig[i], newConfig[idx]];
          break;
        }
      }
    }
    setActivityBarConfig(newConfig);
  };

  const ITEM_LABELS: Record<string, string> = {
    files: "Files",
    search: "Search",
    outline: "Outline",
    backlinks: "Backlinks",
    bookmarks: "Bookmarks",
    graph: "Graph View",
    git: "Source Control",
    calendar: "Calendar",
    tags: "Tags",
    "skills-gallery": "Skills Gallery",
    chat: "AI Chat",
    memories: "Memories",
    "photo-gallery": "Photo Gallery",
    snapshots: "Version History",
    help: "Help",
  };

  const renderSection = (title: string, items: ActivityBarItemConfig[]) => (
    <>
      <SettingsSectionHeader title={title} />
      {items.map((item, idx) => (
        <div key={item.id} className="settings-row activity-bar-config-row">
          <div className="activity-bar-config-left">
            <div className="activity-bar-config-arrows">
              <button
                className="activity-bar-config-arrow"
                onClick={() => moveItem(item.id, "up")}
                disabled={idx === 0}
                title="Move up"
              >
                {"\u25B2"}
              </button>
              <button
                className="activity-bar-config-arrow"
                onClick={() => moveItem(item.id, "down")}
                disabled={idx === items.length - 1}
                title="Move down"
              >
                {"\u25BC"}
              </button>
            </div>
            <span className={`settings-row-label ${!item.visible ? "activity-bar-config-hidden" : ""}`}>
              {ITEM_LABELS[item.id] ?? item.id}
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
        No settings found for &ldquo;{query}&rdquo;
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
                <span className="settings-row-label">{item.label}</span>
                <span className="settings-row-description">
                  {item.section} &middot; {item.description}
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
          <option value="restoreLastFolder">Restore last folder</option>
          <option value="restoreLastFile">Restore last file</option>
          <option value="newFile">New file</option>
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
          <option value={2}>2 spaces</option>
          <option value={4}>4 spaces</option>
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
          <option value="claude">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
          <option value="ollama">Ollama (Local)</option>
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
          Open...
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

// Settings Modal — 8-tab settings (General, Editor, Appearance, Files, Markdown, Extensions, Workspace, AI)
// Obsidian-style layout: label + description per row, section headers for grouping
import { useState, useCallback, useRef, useEffect } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useAIStore } from "../../stores/ai-store";
import { CustomAICommandEditor } from "./CustomAICommandEditor";
import { llmListModels } from "../../ipc/invoke";
import { formatAIError } from "../../utils/format-error";
import type { ModelInfo } from "../../ipc/types";
import { ExtensionsTab } from "./ExtensionsTab";
import { WorkspaceTab } from "./WorkspaceTab";
import { ThemeEditor } from "./ThemeEditor";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "../../ipc/invoke";
import { MigrationDialog } from "../journal/MigrationDialog";
import { initJournalTemplatesDir } from "../../utils/journal-templates";
import { BUILT_IN_THEMES } from "../../types/theme";
import type { ThemeColors, ThemeDef } from "../../types/theme";
import { THEME_COLOR_KEYS } from "../../types/theme";

type SettingsTab = "general" | "editor" | "appearance" | "files" | "markdown" | "extensions" | "ai" | "workspace";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "appearance", label: "Appearance" },
  { id: "files", label: "Files" },
  { id: "markdown", label: "Markdown" },
  { id: "extensions", label: "Extensions" },
  { id: "workspace", label: "Workspace" },
  { id: "ai", label: "AI" },
];

export function SettingsModal() {
  const { settingsOpen, toggleSettings } = useUIStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  if (!settingsOpen) return null;

  return (
    <div className="settings-overlay" onClick={toggleSettings}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">Settings</h2>
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
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="settings-content">
            {activeTab === "general" && <GeneralTab />}
            {activeTab === "editor" && <EditorTab />}
            {activeTab === "appearance" && <AppearanceTab />}
            {activeTab === "files" && <FilesTab />}
            {activeTab === "markdown" && <MarkdownTab />}
            {activeTab === "extensions" && <ExtensionsTab />}
            {activeTab === "workspace" && <WorkspaceTab />}
            {activeTab === "ai" && <AITab />}
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

  /** The 5 swatch keys displayed on each card */
  const SWATCH_KEYS: (keyof ThemeColors)[] = [
    "--color-bg-primary",
    "--color-text-primary",
    "--color-accent",
    "--color-bg-sidebar",
    "--color-border",
  ];

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
          <div className="theme-card-swatches">
            <span
              className="theme-card-swatch"
              style={{
                background: "linear-gradient(135deg, #ffffff 50%, #1a1a2e 50%)",
              }}
            />
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
            <div className="theme-card-swatches">
              {SWATCH_KEYS.map((key) => (
                <span
                  key={key}
                  className="theme-card-swatch"
                  style={{ backgroundColor: theme.colors[key] }}
                  title={key}
                />
              ))}
            </div>
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
    </div>
  );
}

// ─── Files Tab ──────────────────────────────────────────

function FilesTab() {
  const {
    wikilinkFormat, setWikilinkFormat,
    autoUpdateLinks, setAutoUpdateLinks,
  } = useSettingsStore();

  return (
    <div className="settings-section">
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

// ─── Shared Components ──────────────────────────────────

function SettingsSectionHeader({ title }: { title: string }) {
  return <div className="settings-section-header">{title}</div>;
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

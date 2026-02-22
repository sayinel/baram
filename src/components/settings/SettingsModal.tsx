// Settings Modal — 6-tab settings (General, Editor, Appearance, Files, Markdown, AI)
// Obsidian-style layout: label + description per row, section headers for grouping
import { useState, useCallback } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useAIStore } from "../../stores/ai-store";

type SettingsTab = "general" | "editor" | "appearance" | "files" | "markdown" | "ai";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
  { id: "appearance", label: "Appearance" },
  { id: "files", label: "Files" },
  { id: "markdown", label: "Markdown" },
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
            {activeTab === "ai" && <AITab />}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── General Tab ────────────────────────────────────────

function GeneralTab() {
  const {
    onLaunch, setOnLaunch,
    autoSave, setAutoSave,
    autoSaveDelay, setAutoSaveDelay,
    spellCheck, setSpellCheck,
    showWelcome, setShowWelcome,
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
        <input
          type="text"
          className="settings-input"
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
        />
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

      <SettingsRow label="Tab Size" description="Number of spaces per tab">
        <select
          className="settings-select"
          value={tabSize}
          onChange={(e) => setTabSize(Number(e.target.value))}
        >
          <option value={2}>2 spaces</option>
          <option value={4}>4 spaces</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Auto Pair Brackets" description="Automatically close brackets and quotes">
        <ToggleSwitch checked={autoPairBrackets} onChange={setAutoPairBrackets} />
      </SettingsRow>

      <SettingsSectionHeader title="Display" />

      <SettingsRow label="Line Numbers" description="Show line numbers in the gutter">
        <ToggleSwitch checked={lineNumbers} onChange={setLineNumbers} />
      </SettingsRow>

      <SettingsRow label="Editor Max Width" description={`Maximum content width (${editorMaxWidth === 0 ? "No limit" : editorMaxWidth + "px"})`}>
        <input
          type="range"
          className="settings-range"
          min={0}
          max={1200}
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
  const { theme, setTheme } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsSectionHeader title="Theme" />

      <SettingsRow label="Color Scheme" description="Choose the application color scheme">
        <div className="settings-scheme-group">
          {(["light", "dark", "system"] as const).map((value) => (
            <button
              key={value}
              className={`settings-scheme-btn ${theme === value ? "settings-scheme-btn-active" : ""}`}
              onClick={() => setTheme(value)}
            >
              {value === "light" ? "Light" : value === "dark" ? "Dark" : "System"}
            </button>
          ))}
        </div>
      </SettingsRow>
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
    diagrams, setDiagrams,
    codeBlockLineNumbers, setCodeBlockLineNumbers,
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

      <SettingsRow label="Diagrams" description="Render Mermaid diagrams in code blocks">
        <ToggleSwitch checked={diagrams} onChange={setDiagrams} />
      </SettingsRow>

      <SettingsSectionHeader title="Code Blocks" />

      <SettingsRow label="Line Numbers" description="Show line numbers in code blocks">
        <ToggleSwitch checked={codeBlockLineNumbers} onChange={setCodeBlockLineNumbers} />
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
  } = useAIStore();
  const [showKey, setShowKey] = useState(false);

  const handleProviderChange = useCallback(
    (newProvider: "claude" | "openai" | "ollama") => {
      setProvider(newProvider);
      if (newProvider === "claude") setModel("claude-sonnet-4-5-20250929");
      else if (newProvider === "openai") setModel("gpt-4o");
      else if (newProvider === "ollama") setModel("llama3");
    },
    [setProvider, setModel],
  );

  return (
    <div className="settings-section">
      <SettingsSectionHeader title="Provider" />

      <SettingsRow label="AI Provider" description="Choose the AI service for completions">
        <select
          className="settings-select"
          value={provider}
          onChange={(e) => handleProviderChange(e.target.value as "claude" | "openai" | "ollama")}
        >
          <option value="claude">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama (Local)</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Model" description="Model name or ID to use for requests">
        <input
          type="text"
          className="settings-input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </SettingsRow>

      {provider !== "ollama" && (
        <SettingsRow label="API Key" description="Your API key for the selected provider">
          <div className="settings-key-row">
            <input
              type={showKey ? "text" : "password"}
              className="settings-input settings-input-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter API key..."
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

      <SettingsSectionHeader title="Privacy" />

      <SettingsRow label="Privacy Mode" description="Do not send document content to AI providers">
        <ToggleSwitch checked={privacyMode} onChange={setPrivacyMode} />
      </SettingsRow>
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

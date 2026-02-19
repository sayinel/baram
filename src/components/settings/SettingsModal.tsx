// Settings Modal — 3-tab settings (General, Editor, AI)
import { useState, useCallback } from "react";
import { useUIStore } from "../../stores/ui-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useAIStore } from "../../stores/ai-store";

type SettingsTab = "general" | "editor" | "ai";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "editor", label: "Editor" },
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
          <button
            className="settings-close"
            onClick={toggleSettings}
            title="Close"
          >
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
    theme, setTheme,
    autoSave, setAutoSave,
    autoSaveDelay, setAutoSaveDelay,
    spellCheck, setSpellCheck,
    showWelcome, setShowWelcome,
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsRow label="Theme">
        <select
          className="settings-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as "light" | "dark" | "system")}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Auto Save">
        <ToggleSwitch checked={autoSave} onChange={setAutoSave} />
      </SettingsRow>

      {autoSave && (
        <SettingsRow label="Auto Save Delay" hint={`${autoSaveDelay}ms`}>
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

      <SettingsRow label="Spell Check">
        <ToggleSwitch checked={spellCheck} onChange={setSpellCheck} />
      </SettingsRow>

      <SettingsRow label="Show Welcome on Startup">
        <ToggleSwitch checked={showWelcome} onChange={setShowWelcome} />
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
  } = useSettingsStore();

  return (
    <div className="settings-section">
      <SettingsRow label="Font Family">
        <input
          type="text"
          className="settings-input"
          value={fontFamily}
          onChange={(e) => setFontFamily(e.target.value)}
        />
      </SettingsRow>

      <SettingsRow label="Font Size" hint={`${fontSize}px`}>
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

      <SettingsRow label="Line Height" hint={lineHeight.toFixed(2)}>
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

      <SettingsRow label="Tab Size">
        <select
          className="settings-select"
          value={tabSize}
          onChange={(e) => setTabSize(Number(e.target.value))}
        >
          <option value={2}>2 spaces</option>
          <option value={4}>4 spaces</option>
        </select>
      </SettingsRow>
    </div>
  );
}

// ─── AI Tab ─────────────────────────────────────────────

function AITab() {
  const { provider, setProvider, model, setModel, apiKey, setApiKey } =
    useAIStore();
  const [showKey, setShowKey] = useState(false);

  const handleProviderChange = useCallback(
    (newProvider: "claude" | "openai" | "ollama") => {
      setProvider(newProvider);
      // Set default model per provider
      if (newProvider === "claude") setModel("claude-sonnet-4-5-20250929");
      else if (newProvider === "openai") setModel("gpt-4o");
      else if (newProvider === "ollama") setModel("llama3");
    },
    [setProvider, setModel],
  );

  return (
    <div className="settings-section">
      <SettingsRow label="Provider">
        <select
          className="settings-select"
          value={provider}
          onChange={(e) =>
            handleProviderChange(e.target.value as "claude" | "openai" | "ollama")
          }
        >
          <option value="claude">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama (Local)</option>
        </select>
      </SettingsRow>

      <SettingsRow label="Model">
        <input
          type="text"
          className="settings-input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </SettingsRow>

      {provider !== "ollama" && (
        <SettingsRow label="API Key">
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
    </div>
  );
}

// ─── Shared Components ──────────────────────────────────

function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span>{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
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

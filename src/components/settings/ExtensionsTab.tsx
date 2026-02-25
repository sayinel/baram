// ExtensionsTab — auto-renders settings UI from registry.json Extension metadata
// Each Extension with a "settings" array gets a section with appropriate controls.
import { useSettingsStore } from "../../stores/settings-store";
import registry from "../../extensions/registry.json";

// ─── Types ───────────────────────────────────────────────

interface SettingOption {
  value: string;
  label: string;
}

interface SettingDef {
  key: string;
  type: "boolean" | "select" | "number" | "string";
  label: string;
  description: string;
  default: unknown;
  options?: SettingOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}

interface RegistryEntry {
  name: string;
  settings?: SettingDef[];
}

// ─── Helpers ─────────────────────────────────────────────

/** Collect all registry entries (nodes, marks, plugins) that have settings. */
function getExtensionsWithSettings(): { name: string; settings: SettingDef[] }[] {
  const allEntries: RegistryEntry[] = [
    ...(registry.nodes as RegistryEntry[]),
    ...(registry.marks as RegistryEntry[]),
    ...(registry.plugins as RegistryEntry[]),
  ];

  return allEntries
    .filter((entry): entry is RegistryEntry & { settings: SettingDef[] } =>
      Array.isArray(entry.settings) && entry.settings.length > 0,
    )
    .map((entry) => ({ name: entry.name, settings: entry.settings }));
}

/** Convert camelCase name to Title Case (e.g. "codeBlock" -> "Code Block"). */
function formatName(name: string): string {
  // Insert a space before each uppercase letter, then capitalize the first letter
  const spaced = name.replace(/([A-Z])/g, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ─── Components ──────────────────────────────────────────

export function ExtensionsTab() {
  const extensions = getExtensionsWithSettings();

  if (extensions.length === 0) {
    return (
      <div className="settings-section">
        <div className="settings-section-header">Extensions</div>
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">No configurable extensions</span>
            <span className="settings-row-description">
              Extensions with settings will appear here automatically.
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-section">
      {extensions.map((ext) => (
        <div key={ext.name}>
          <div className="settings-section-header">{formatName(ext.name)}</div>
          {ext.settings.map((setting) => (
            <ExtensionSettingRow key={setting.key} setting={setting} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ExtensionSettingRow({ setting }: { setting: SettingDef }) {
  const { extensionSettings, setExtensionSetting } = useSettingsStore();
  const value = extensionSettings[setting.key] ?? setting.default;

  switch (setting.type) {
    case "boolean":
      return (
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{setting.label}</span>
            <span className="settings-row-description">{setting.description}</span>
          </div>
          <div className="settings-row-control">
            <button
              className={`settings-toggle ${value ? "settings-toggle-on" : ""}`}
              onClick={() => setExtensionSetting(setting.key, !value)}
              role="switch"
              aria-checked={!!value}
            >
              <span className="settings-toggle-thumb" />
            </button>
          </div>
        </div>
      );

    case "select":
      return (
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{setting.label}</span>
            <span className="settings-row-description">{setting.description}</span>
          </div>
          <div className="settings-row-control">
            <select
              className="settings-select"
              value={value as string}
              onChange={(e) => setExtensionSetting(setting.key, e.target.value)}
            >
              {(setting.options ?? []).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      );

    case "number":
      return (
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{setting.label}</span>
            <span className="settings-row-description">
              {setting.description} ({value as number})
            </span>
          </div>
          <div className="settings-row-control">
            <input
              type="range"
              className="settings-range"
              min={setting.min ?? 0}
              max={setting.max ?? 100}
              step={setting.step ?? 1}
              value={value as number}
              onChange={(e) => setExtensionSetting(setting.key, Number(e.target.value))}
            />
          </div>
        </div>
      );

    case "string":
      return (
        <div className="settings-row">
          <div className="settings-row-info">
            <span className="settings-row-label">{setting.label}</span>
            <span className="settings-row-description">{setting.description}</span>
          </div>
          <div className="settings-row-control">
            <input
              type="text"
              className="settings-input"
              value={value as string}
              onChange={(e) => setExtensionSetting(setting.key, e.target.value)}
              placeholder={setting.placeholder ?? ""}
            />
          </div>
        </div>
      );

    default:
      return null;
  }
}

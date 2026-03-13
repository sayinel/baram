import registry from "../../../extensions/registry.json";
import { useTranslation } from "../../../i18n/useTranslation";
import { useSettingsStore } from "../../../stores/settings-store";
import {
  SettingsRow,
  SettingsSectionHeader,
  ToggleSwitch,
} from "../settings-shared";

// ─── Extension Settings Types & Helpers ─────────────────

interface RegistryEntry {
  name: string;
  settings?: SettingDef[];
}

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

export function MarkdownTab() {
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

function formatExtName(name: string): string {
  const spaced = name.replace(/([A-Z])/g, " $1");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// ─── Markdown Tab ───────────────────────────────────────

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

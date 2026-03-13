import type { SettingControlMeta } from "./settings-registry";

// SearchSettingControl — data-driven renderer for settings in search results
// Replaces the 29-case switch with a generic renderer per controlType
import { useTranslation } from "../../i18n/useTranslation";
import { NAVIGATE_CONTROL } from "./settings-registry";
import { ToggleSwitch } from "./settings-shared";

interface SearchSettingControlProps {
  control: SettingControlMeta;
  onNavigate: () => void;
}

export function SearchSettingControl({
  control,
  onNavigate,
}: SearchSettingControlProps) {
  const { t } = useTranslation();

  // NAVIGATE_CONTROL is the sentinel for settings that have no inline control
  if (control === NAVIGATE_CONTROL || control.controlType === "custom") {
    if (control.customRender) {
      const value = control.storeSelector();
      return control.customRender({ value, onChange: control.storeSetter });
    }
    return (
      <button className="theme-action-btn" onClick={onNavigate}>
        {t("settings.search.open")}
      </button>
    );
  }

  const value = control.storeSelector();

  if (control.controlType === "toggle") {
    return (
      <ToggleSwitch
        checked={value as boolean}
        onChange={control.storeSetter as (v: boolean) => void}
      />
    );
  }

  if (control.controlType === "slider") {
    const { min, max, step } = control.range!;
    return (
      <input
        className="settings-range"
        max={max}
        min={min}
        onChange={(e) => control.storeSetter(Number(e.target.value))}
        step={step}
        type="range"
        value={value as number}
      />
    );
  }

  if (control.controlType === "select") {
    return (
      <select
        className="settings-select"
        onChange={(e) => control.storeSetter(e.target.value)}
        value={value as string}
      >
        {control.options!.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {/* Labels may be i18n keys or raw strings (e.g. "[[Wikilink]]") */}
            {opt.label.startsWith("settings.") ? t(opt.label) : opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (control.controlType === "input") {
    return (
      <input
        className="settings-input"
        onChange={(e) => control.storeSetter(e.target.value)}
        type="text"
        value={value as string}
      />
    );
  }

  if (control.controlType === "color") {
    return (
      <input
        className="settings-color"
        onChange={(e) => control.storeSetter(e.target.value)}
        type="color"
        value={value as string}
      />
    );
  }

  return null;
}

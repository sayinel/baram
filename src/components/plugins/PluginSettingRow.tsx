import { useEffect, useState } from "react";

import type {
  PluginSettingField,
  PluginSettingValue,
} from "../../plugins/types";

import { useTranslation } from "../../i18n/useTranslation";
import {
  MAX_SETTING_VALUE_CHARS,
  sanitizeSettingDescription,
  sanitizeSettingLabel,
} from "../../plugins/plugin-settings";
import { SETTING_COLOR_SWATCHES } from "./setting-color-swatches";

interface PluginSettingRowProps {
  field: PluginSettingField;
  onChange: (value: PluginSettingValue) => void;
  value: PluginSettingValue;
}

/**
 * One declared field, as the control its type calls for (§260 Phase 4c, widened by §0054).
 *
 * The label and the optional description are the AUTHOR's text rendered in the app's own
 * chrome, so both go through the settings sanitisers — same rule as the status bar's.
 */
export function PluginSettingRow({
  field,
  onChange,
  value,
}: PluginSettingRowProps) {
  const label = sanitizeSettingLabel(field.label);
  const description = field.description
    ? sanitizeSettingDescription(field.description)
    : "";
  return (
    <div className="plugin-setting-row">
      <label className="plugin-setting-row__line">
        {label}
        <SettingControl field={field} onChange={onChange} value={value} />
      </label>
      {description ? (
        <p className="plugin-setting-row__description">{description}</p>
      ) : null}
      {field.type === "color" ? (
        <ColorSwatches onChange={onChange} value={String(value)} />
      ) : null}
    </div>
  );
}

/**
 * The recommended colours, under the text input they write into.
 *
 * A swatch is `aria-pressed` when the field currently holds its value, so the control reports
 * its own state rather than leaving the user to compare a token string against eight circles.
 * A hand-typed colour matches no swatch, which is correct — none of them is selected.
 */
function ColorSwatches({
  onChange,
  value,
}: {
  onChange: (value: PluginSettingValue) => void;
  value: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      aria-label={t("plugin.settings.color.swatches")}
      className="plugin-setting-swatches"
      role="group"
    >
      {SETTING_COLOR_SWATCHES.map((swatch) => {
        const name = t(swatch.labelKey);
        return (
          <button
            aria-label={name}
            aria-pressed={value === swatch.value}
            className="plugin-setting-swatch"
            key={swatch.value}
            onClick={() => onChange(swatch.value)}
            // The one place an inline style is the only option: the colour IS the data.
            style={{ background: swatch.value }}
            title={name}
            type="button"
          />
        );
      })}
    </div>
  );
}

/**
 * A number input keeps a local draft; the others are plain controlled inputs.
 *
 * Why the draft: clearing the box to type a new number makes it momentarily empty, and a
 * controlled input backed by the store would snap straight back to the old value — the
 * field could never be retyped. So the draft is what the user sees, and only a finite
 * number is committed. `resolvePluginSettings` refuses a non-finite value on the way out
 * too, but that would arrive as a persisted `null`, which is worth not writing at all.
 *
 * ‼️ `min`/`max` reach the `<input>`, but the browser does NOT stop a typed value outside
 * them — `type="number"` only marks such a value invalid. The resolver is the gate; these
 * attributes are what make the stepper obey the range and what a screen reader announces.
 */
function SettingControl({ field, onChange, value }: PluginSettingRowProps) {
  const [draft, setDraft] = useState(String(value));
  // Resync when the value moves underneath us — a settings reset, a reinstall, or the
  // record being cleared on uninstall.
  useEffect(() => {
    if (field.type === "number") setDraft(String(value));
  }, [field.type, value]);

  if (field.type === "boolean") {
    return (
      <input
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        type="checkbox"
      />
    );
  }
  if (field.type === "number") {
    return (
      <input
        className="plugin-setting-control plugin-setting-control--number"
        max={field.max}
        min={field.min}
        onChange={(e) => {
          setDraft(e.target.value);
          const next = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(next)) onChange(next);
        }}
        type="number"
        value={draft}
      />
    );
  }
  if (field.type === "enum") {
    return (
      <select
        className="plugin-setting-control"
        onChange={(e) => onChange(e.target.value)}
        value={String(value)}
      >
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {sanitizeSettingLabel(option.label)}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className="plugin-setting-control"
      // Capped where it is TYPED as well as where it is read: the read-side clamp keeps
      // the payload bounded, but silently truncating what the user typed would be its
      // own bug.
      maxLength={MAX_SETTING_VALUE_CHARS}
      onChange={(e) => onChange(e.target.value)}
      type="text"
      value={String(value)}
    />
  );
}

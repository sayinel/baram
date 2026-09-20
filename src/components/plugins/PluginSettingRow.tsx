import { useEffect, useId, useState } from "react";

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
  // The description sits OUTSIDE the `<label>` (it belongs under the row, not beside the
  // control), so nothing associates the two without this — a screen reader would announce the
  // label and the control and never the sentence the field exists to explain.
  //
  // `useId` rather than the field's key: the same plugin's form can be mounted twice (the
  // settings pane and a plugin detail route), and two elements sharing an `id` make
  // `aria-describedby` resolve to whichever the document happens to hold first.
  const descriptionId = useId();
  const describedBy = description ? descriptionId : undefined;
  return (
    <div className="plugin-setting-row">
      <label className="plugin-setting-row__line">
        {label}
        <SettingControl
          describedBy={describedBy}
          field={field}
          onChange={onChange}
          value={value}
        />
      </label>
      {description ? (
        <p className="plugin-setting-row__description" id={describedBy}>
          {description}
        </p>
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
 * Whether `resolvePluginSettings` would keep this box's contents for this field.
 *
 * ‼️ ONE spelling, asked twice — once to decide whether to commit and once to decide whether
 * to flag the control. Written inline in both places they could answer differently, and the
 * shape that produces is a box the app calls valid while the plugin is told something else.
 * It deliberately mirrors `coerce`'s number arm rather than importing it: `coerce` takes an
 * already-typed value and this takes the raw string the user is part-way through.
 */
function keepsValue(field: PluginSettingField, raw: string): boolean {
  if (raw === "") return false;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  if (typeof field.min === "number" && n < field.min) return false;
  if (typeof field.max === "number" && n > field.max) return false;
  return true;
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
 * them — `type="number"` only marks such a value invalid. So the range is enforced HERE as
 * well, by refusing to commit: the resolver is still the gate for a record edited on disk,
 * but a value it would refuse must never be persisted from a control the user is looking at.
 * The attributes remain for the stepper and for what a screen reader announces.
 */
function SettingControl({
  describedBy,
  field,
  onChange,
  value,
}: PluginSettingRowProps & { describedBy?: string }) {
  const [draft, setDraft] = useState(String(value));
  // Resync when the value moves underneath us — a settings reset, a reinstall, or the
  // record being cleared on uninstall.
  useEffect(() => {
    if (field.type === "number") setDraft(String(value));
  }, [field.type, value]);

  if (field.type === "boolean") {
    return (
      <input
        aria-describedby={describedBy}
        checked={value === true}
        onChange={(e) => onChange(e.target.checked)}
        type="checkbox"
      />
    );
  }
  if (field.type === "number") {
    return (
      <input
        // An empty box is mid-edit, not wrong; anything else the resolver would refuse is.
        aria-describedby={describedBy}
        aria-invalid={draft !== "" && !keepsValue(field, draft)}
        className="plugin-setting-control plugin-setting-control--number"
        max={field.max}
        min={field.min}
        onChange={(e) => {
          setDraft(e.target.value);
          // ‼️ COMMIT ONLY WHAT THE RESOLVER WOULD KEEP (§0054 code review, MEDIUM).
          // Committing an out-of-range value did two bad things at once, and the second made
          // a field unusable: the resolver refused it and fell back to the DEFAULT, which
          // changed the resolved value, which fired the resync effect above and rewrote the
          // box under the user's fingers — so on a 0.5–8 field, typing the leading `0` of
          // `0.5` turned the box into `2` and `0.5` could not be reached at all. Refusing to
          // commit leaves the resolved value still, so the draft survives being typed.
          if (keepsValue(field, e.target.value))
            onChange(Number(e.target.value));
        }}
        type="number"
        value={draft}
      />
    );
  }
  if (field.type === "enum") {
    return (
      <select
        aria-describedby={describedBy}
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
      aria-describedby={describedBy}
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

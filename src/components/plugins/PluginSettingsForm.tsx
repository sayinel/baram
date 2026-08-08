import { useEffect, useMemo, useState } from "react";

import type {
  PluginSettingField,
  PluginSettingValue,
} from "../../plugins/types";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
// §260 Phase 4c — the user's side of `contributions.settings`. The manifest asks the
// questions; this is where they get answered, and the answers are the app's to keep (see
// `plugin-settings.ts` for why a plugin may only read them).
import {
  declaredSettingsFor,
  MAX_SETTING_VALUE_CHARS,
  resolvePluginSettings,
  sanitizeSettingLabel,
} from "../../plugins/plugin-settings";
import { selectManifest } from "../../plugins/plugin-sources";
import { usePluginStore } from "../../stores/system/plugin";

interface PluginSettingsFormProps {
  pluginId: string;
}

/**
 * Renders one row per DECLARED field, or nothing at all.
 *
 * Nothing at all covers three cases deliberately: the plugin is not installed, it declares
 * no fields, or it declares fields without the `settings` capability. The last one matches
 * how the status bar treats an undeclared capability (§260 Phase 4a) — a manifest must not
 * buy space in the app's chrome with a permission the user was never shown, and the same
 * `declaredSettingsFor` decides it here and in both tiers' read paths, so the form and the
 * plugin can never disagree about which fields exist.
 *
 * The section heading is localised (#329); the field labels themselves come from the
 * manifest and are the author's, so they are rendered as authored.
 */
export function PluginSettingsForm({ pluginId }: PluginSettingsFormProps) {
  const { t } = useTranslation();
  const { manifest, persisted, setPluginSetting } = usePluginStore(
    useShallow((s) => ({
      // ‼️ §5.2 — `installedPlugins[id] ?? devPlugins[id]`였다. 내장은 어느 쪽에도 없으므로
      // 내장의 설정 폼이 조용히, 오류 없이 안 그려졌다. `selectManifest`가 세 출처를 다 본다.
      // 셀렉터 안에서 부르는 것이 구독을 유지하는 유일한 방법이다 — 위 함수의 주석을 볼 것.
      manifest: selectManifest(s, pluginId),
      persisted: s.pluginSettings[pluginId],
      setPluginSetting: s.setPluginSetting,
    })),
  );
  // Memoised for its IDENTITY, not its cost: `declaredSettingsFor` returns a fresh `[]`
  // for a plugin with no fields, which would re-run the resolver below every render.
  const declared = useMemo(
    () => (manifest ? declaredSettingsFor(manifest) : []),
    [manifest],
  );
  // Resolved, never read raw: the persisted record outlives the manifest that wrote it, so
  // the form has to show what the plugin will actually be told.
  const values = useMemo(
    () => resolvePluginSettings(declared, persisted),
    [declared, persisted],
  );

  if (declared.length === 0) return null;

  return (
    <div style={{ marginBottom: "20px" }}>
      <h3
        style={{
          fontSize: "14px",
          fontWeight: 600,
          marginBottom: "8px",
          color: "var(--color-text-primary)",
        }}
      >
        {t("plugin.settings.title")}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {declared.map((field) => (
          <SettingRow
            field={field}
            key={field.key}
            onChange={(value) => setPluginSetting(pluginId, field.key, value)}
            value={values[field.key]}
          />
        ))}
      </div>
    </div>
  );
}

const CONTROL_STYLE = {
  backgroundColor: "var(--color-bg-default)",
  border: "1px solid var(--color-border-default)",
  borderRadius: "4px",
  color: "var(--color-text-primary)",
  fontSize: "13px",
  padding: "4px 6px",
} as const;

const LABEL_STYLE = {
  alignItems: "center",
  color: "var(--color-text-secondary)",
  display: "flex",
  fontSize: "13px",
  gap: "8px",
  justifyContent: "space-between",
} as const;

/**
 * A number input keeps a local draft; the others are plain controlled inputs.
 *
 * Why the draft: clearing the box to type a new number makes it momentarily empty, and a
 * controlled input backed by the store would snap straight back to the old value — the
 * field could never be retyped. So the draft is what the user sees, and only a finite
 * number is committed. `resolvePluginSettings` refuses a non-finite value on the way out
 * too, but that would arrive as a persisted `null`, which is worth not writing at all.
 */
function SettingRow({
  field,
  onChange,
  value,
}: {
  field: PluginSettingField;
  onChange: (value: PluginSettingValue) => void;
  value: PluginSettingValue;
}) {
  const label = sanitizeSettingLabel(field.label);
  const [draft, setDraft] = useState(String(value));
  // Resync when the value moves underneath us — a settings reset, a reinstall, or the
  // record being cleared on uninstall.
  useEffect(() => {
    if (field.type === "number") setDraft(String(value));
  }, [field.type, value]);

  if (field.type === "boolean") {
    return (
      <label style={LABEL_STYLE}>
        {label}
        <input
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          type="checkbox"
        />
      </label>
    );
  }
  if (field.type === "number") {
    return (
      <label style={LABEL_STYLE}>
        {label}
        <input
          onChange={(e) => {
            setDraft(e.target.value);
            const next = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(next)) onChange(next);
          }}
          style={{ ...CONTROL_STYLE, width: "96px" }}
          type="number"
          value={draft}
        />
      </label>
    );
  }
  return (
    <label style={LABEL_STYLE}>
      {label}
      <input
        // Capped where it is TYPED as well as where it is read: the read-side clamp keeps
        // the payload bounded, but silently truncating what the user typed would be its
        // own bug.
        maxLength={MAX_SETTING_VALUE_CHARS}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...CONTROL_STYLE, width: "180px" }}
        type="text"
        value={String(value)}
      />
    </label>
  );
}

import { useMemo } from "react";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
// §260 Phase 4c — the user's side of `contributions.settings`. The manifest asks the
// questions; this is where they get answered, and the answers are the app's to keep (see
// `plugin-settings.ts` for why a plugin may only read them).
import {
  declaredSettingsFor,
  resolvePluginSettings,
} from "../../plugins/plugin-settings";
import { selectManifest } from "../../plugins/plugin-sources";
import { usePluginStore } from "../../stores/system/plugin";
import { PluginSettingRow } from "./PluginSettingRow";

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
 *
 * §0054 moved the controls to `PluginSettingRow` — four types and a swatch palette do not
 * fit beside the shell, and the shell is the part with the capability argument above.
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
    <div className="plugin-settings-form">
      <h3 className="plugin-settings-form__title">
        {t("plugin.settings.title")}
      </h3>
      <div className="plugin-settings-form__rows">
        {declared.map((field) => (
          <PluginSettingRow
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

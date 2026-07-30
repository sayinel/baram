import type { PluginCapability } from "../../plugins/types";

import { CAPABILITY_DESCRIPTIONS } from "../../plugins/types";

/**
 * The user-facing description of a capability, in the app's language.
 *
 * `CAPABILITY_DESCRIPTIONS` cannot simply hold the translations. Its KEYS are the validation
 * allowlist — `manifest.ts` derives `VALID_CAPABILITIES` from `Object.keys(...)` precisely so the
 * compiler refuses to let the list fall behind the `PluginCapability` union — and it is part of
 * the published plugin API (`examples/plugins/types.d.ts`), so its `Record<PluginCapability,
 * string>` shape is a contract with plugin authors. It stays as it is; the display text moves
 * here.
 *
 * The map is still the fallback, and not merely defensively: it is the one source that structurally
 * cannot be missing a member, so a capability added to the union with NO `plugin.capability.*` key
 * in either locale degrades to Korean prose instead of printing "plugin.capability.whatever" at
 * the user.
 *
 * ‼️ That covers only the both-missing case, which is not the likely one. `t()` is
 * `translations[locale]?.[key] ?? translations.en?.[key] ?? key`, so a key added to en.json and
 * forgotten in ko.json returns ENGLISH — `translated !== key`, this fallback never runs, and a
 * Korean user reads an English line. That is the defect this whole change set exists to remove,
 * and nothing here can detect it. The guard for it is the en/ko parity assertion in
 * `src/i18n/__tests__/locale-parity.test.ts`; this function is only the last resort.
 */
export function capabilityLabel(
  capability: PluginCapability,
  t: (key: string) => string,
): string {
  const key = `plugin.capability.${capability}`;
  const translated = t(key);
  // `t()` returns the key itself when nothing matches in the active locale or in English.
  return translated === key
    ? (CAPABILITY_DESCRIPTIONS[capability] ?? capability)
    : translated;
}

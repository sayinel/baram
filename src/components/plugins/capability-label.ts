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
 * cannot be missing a member, so a capability added to the union without its `plugin.capability.*`
 * keys degrades to the old behaviour instead of printing "plugin.capability.whatever" at the user.
 * `capability-label.test.ts` fails in that case, so the fallback should never be reached in a
 * shipped build.
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

// §260 Phase 4c — the value model for `contributions.settings`, shared by everything
// that touches a plugin setting: the manifest validator, the settings form, and both
// tiers' read paths.
//
// WHY one resolver rather than reading the store directly: what is PERSISTED and what a
// plugin is TOLD are different things. The persisted record outlives the manifest that
// created it — a plugin update can change a field's type, drop a field, or rename one —
// so the manifest in front of us is the only trustworthy description of what its keys
// mean. Everything below follows from that.
import type { PluginSettingField, PluginSettingValue } from "./types";

import { sanitizePluginText } from "./plugin-text";

/**
 * How many fields one plugin may declare, and how long a string value may be.
 *
 * Together these bound the payload: 16 × 512 is ~9 KiB, which is why the values travel as
 * a staged pull rather than in a response frame (tauri queues a frame at 8 KiB — see
 * `host-settings-bridge`). They are in ONE place because that argument needs both numbers;
 * moving either without the other silently changes what the transport has to carry.
 */
export const MAX_SETTING_FIELDS = 16;
export const MAX_SETTING_VALUE_CHARS = 512;

/**
 * What a plugin is told its settings are: one entry per DECLARED field, in declaration
 * order, each a value of the declared type.
 *
 * The rules, and what each one is for:
 *
 * - **A persisted value is used only if its `typeof` matches the declared type.** A plugin
 *   update can change `count` from `string` to `number`; handing over the old value would
 *   make `value.toFixed()` throw inside the sandbox, where the author cannot see it.
 * - **Then the declared `default`** — also type-checked, because a manifest can be edited
 *   by hand after install, so validation at install time is not a guarantee here.
 * - **Then the type's zero**, so a field always has a value and a plugin never needs an
 *   `undefined` branch for something its own manifest declares.
 * - **Keys the manifest does not declare are dropped.** This is what makes the manifest the
 *   payload's bound, and it stops a renamed key's stale value from resurfacing under the
 *   old name.
 * - **Non-finite numbers fall back** like a type mismatch. `JSON.parse` cannot produce
 *   `NaN`, but the persisted file is hand-editable and `1e999` parses to `Infinity`.
 * - **Strings are clamped**, for the payload bound above. Control characters are NOT
 *   stripped: the destination is the plugin, and every path that renders plugin-supplied
 *   text in the app's own chrome sanitises at its own boundary (`label` below, the status
 *   bar in `host-ui-bridge`). Stripping here would only make a value differ from what the
 *   user typed for no gain.
 *
 * What this deliberately does NOT do is write anything back. The persisted record keeps a
 * value whose field disappeared, so a plugin update that temporarily drops a field does not
 * destroy the user's answer; `removePlugin` clears the whole record on uninstall.
 */
export function resolvePluginSettings(
  declared: readonly PluginSettingField[] | undefined,
  persisted: Record<string, unknown> | undefined,
): Record<string, PluginSettingValue> {
  const resolved: Record<string, PluginSettingValue> = {};
  for (const field of declared ?? []) {
    resolved[field.key] = resolveOne(field, persisted?.[field.key]);
  }
  return resolved;
}

/**
 * Author-supplied text on its way into the app's own settings pane.
 *
 * Same class as the status-bar text (§260 Phase 4a): a `label` is written by the plugin
 * author and rendered in the app's chrome, so a newline-bearing or 4,000-character label is
 * a layout attack on the settings pane. Kept next to the resolver because it is the other
 * half of "what the manifest says" being untrusted input.
 */
export function sanitizeSettingLabel(raw: string): string {
  return sanitizePluginText(raw, MAX_SETTING_LABEL_CHARS);
}

/** As long as a settings row can show without wrapping into the next field. */
const MAX_SETTING_LABEL_CHARS = 80;

/** `undefined` for anything that is not a usable value of `type`. */
function coerce(
  value: unknown,
  type: PluginSettingField["type"],
): PluginSettingValue | undefined {
  if (typeof value !== type) return undefined;
  if (type === "number" && !Number.isFinite(value)) return undefined;
  if (type === "string") {
    return (value as string).slice(0, MAX_SETTING_VALUE_CHARS);
  }
  return value as PluginSettingValue;
}

function resolveOne(
  field: PluginSettingField,
  persisted: unknown,
): PluginSettingValue {
  return (
    coerce(persisted, field.type) ??
    coerce(field.default, field.type) ??
    ZERO[field.type]
  );
}

const ZERO: Record<PluginSettingField["type"], PluginSettingValue> = {
  boolean: false,
  number: 0,
  string: "",
};

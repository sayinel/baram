// §260 Phase 4c — the value model for `contributions.settings`, shared by everything
// that touches a plugin setting: the manifest validator, the settings form, and both
// tiers' read paths.
//
// WHY one resolver rather than reading the store directly: what is PERSISTED and what a
// plugin is TOLD are different things. The persisted record outlives the manifest that
// created it — a plugin update can change a field's type, drop a field, or rename one —
// so the manifest in front of us is the only trustworthy description of what its keys
// mean. Everything below follows from that.
import type {
  PluginManifest,
  PluginSettingField,
  PluginSettingValue,
} from "./types";

import { sanitizePluginText } from "./plugin-text";
import { SETTING_TYPES } from "./types";

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
 * The fields this plugin actually has — the ONE answer, shared by the form and by both
 * tiers' read paths.
 *
 * Empty without the `settings` capability, even when the manifest declares fields. Same
 * rule as the status bar (§260 Phase 4a, security review MEDIUM-3): a manifest must not buy
 * space in the app's chrome with a permission the install dialog never showed, and reading
 * a value the user set requires the same grant as asking for it. Silent — an ignored
 * decoration should not stop a plugin whose commands are fine — and one function rather
 * than three checks, so the form cannot show a field the plugin will never be told about.
 *
 * ‼️ NOTHING about the manifest is trusted here, for the same reason the resolver distrusts
 * a persisted value — and the gap is wider than it looks. `validateManifest` runs on the
 * LOAD path (`plugin-loader.ts`), but the record this reads is written on the INSTALL path,
 * BEFORE and independently of it: `PluginMarketplace` calls `addPlugin` and only then
 * `loadPlugin`, whose failure is caught and turned into an error badge — the record stays.
 * Rust does not cover the gap either: it types `contributions` as an opaque
 * `serde_json::Value` and never inspects it.
 *
 * So a manifest reaching this function may be ANY shape, and the app's only error boundary
 * is at the root (`App.tsx`): a throw while rendering a settings row replaces the entire
 * app with the error UI, on a route that includes the plugin's own Uninstall button, every
 * time Settings → Plugins is opened. A plugin that never executes a line of code could brick
 * the app with a manifest alone (§260 Phase 4c security review, MEDIUM-1).
 *
 * Hence three guards, each closing one observed crash or unbounded render:
 * `settings` not an array, a field whose `label` is missing or not a string, and a field
 * count nothing on this path caps.
 */
export function declaredSettingsFor(
  manifest: Pick<PluginManifest, "capabilities" | "contributions">,
): PluginSettingField[] {
  if (!manifest.capabilities.includes("settings")) return [];
  const declared = manifest.contributions?.settings;
  if (!Array.isArray(declared)) return [];
  const seen = new Set<string>();
  return (
    declared
      .filter((field) => {
        if (!isUsableField(field) || seen.has(field.key)) return false;
        // First occurrence wins. Two fields with one key would render two controls driving
        // the same value, which is what the duplicate-key validation prevents at install.
        seen.add(field.key);
        return true;
      })
      // The same cap the validator applies, applied again where the untrusted record is
      // READ. Without it a manifest declaring 5,000 fields rendered 5,000 inputs.
      .slice(0, MAX_SETTING_FIELDS)
  );
}

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
  // ‼️ NULL-prototype, not `{}` (§260 Phase 4c security review, LOW-3). `CONTRIBUTION_ID`
  // admits `__proto__`, and `plain["__proto__"] = true` invokes the inherited SETTER, which
  // ignores a primitive — so the key vanished and the read came back as `Object.prototype`.
  // A `{key: "__proto__", type: "boolean", default: true}` field rendered permanently
  // UNCHECKED and never reached the plugin, which for a "send telemetry"-shaped toggle is a
  // control misreporting its own state. Not prototype POLLUTION — `coerce` only ever yields
  // a primitive, and a persisted `__proto__`/`constructor` is neutralised by its `typeof`
  // check — but a field that silently does nothing is its own bug. The validator now refuses
  // the key too; this keeps records written before it honest.
  const resolved = Object.create(null) as Record<string, PluginSettingValue>;
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

/**
 * Enough of a field to render and to resolve: a non-empty string key, a type the resolver
 * knows, and a string `label`.
 *
 * ‼️ `label` IS required, and an earlier version of this comment said the opposite — that a
 * missing one "renders as an empty label, which is ugly but honest". It does not:
 * `sanitizeSettingLabel(undefined)` reaches `raw.replace` and throws, which at the root
 * error boundary is the whole app (§260 Phase 4c security review, MEDIUM-1). The rationale
 * would only have held if the sanitiser tolerated a non-string, and it does not.
 */
function isUsableField(field: PluginSettingField): boolean {
  return (
    typeof field?.key === "string" &&
    field.key.length > 0 &&
    typeof field.label === "string" &&
    SETTING_TYPES.includes(field.type)
  );
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

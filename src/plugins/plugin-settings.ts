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
  PluginSettingOption,
  PluginSettingValue,
} from "./types";

import { sanitizePluginText } from "./plugin-text";
import { SETTING_TYPES, SETTING_VALUE_TYPES } from "./types";

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
 * What a `color` value may contain — the host's half of the check (§0054).
 *
 * Exported because the VALIDATOR needs the same rule: a `default` the resolver would refuse
 * has to be an install-time error, not a value that silently disappears. One definition, so
 * the two cannot drift.
 *
 * ‼️ This does NOT relieve a plugin of validating the string itself, and Bullet Threading's
 * own `SAFE_COLOR` stays. The value's destination is a stylesheet the PLUGIN builds, so the
 * plugin is the one that knows where it is pasted; this is the type keeping its own promise
 * (a `color` field yields something that is plausibly a colour) so that a hand-edited record
 * cannot hand a well-behaved plugin a declaration terminator.
 *
 * A character allowlist rather than a colour parser, for the same reason as the plugin's:
 * every character that could end a declaration and start a rule of its own (`;`, `{`, `}`,
 * `:`, `/`, `@`) is absent from the set, which is the property that matters. Wide enough for
 * hex, `rgb()`, `hsl()`, `color-mix()`, a colour name, and `var(--token)` — pointing a plugin
 * at one of the app's own tokens is what the form's swatches do.
 *
 * ‼️ The modern slash syntax (`rgb(0 0 0 / 30%)`) is REFUSED, because `/` is in that set.
 * Deliberate, and the same refusal the plugin already makes; the comma forms are accepted and
 * the swatches produce tokens.
 */
export function isSafeSettingColor(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && SAFE_COLOR.test(trimmed);
}

/**
 * §0054 — the same treatment for a field's `description`, on its own longer cap.
 *
 * Longer because the purpose is different: a `label` names the field in one glance, a
 * description is the sentence that used to be exiled to the plugin's README ("any CSS
 * colour, or one of Baram's theme tokens"). Still capped, and still sanitised, for the
 * reason `label` is — author text rendered in the app's own chrome.
 */
export function sanitizeSettingDescription(raw: string): string {
  return sanitizePluginText(raw, MAX_SETTING_DESCRIPTION_CHARS);
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

/** Two rows of help text under a field, at the settings pane's width. */
const MAX_SETTING_DESCRIPTION_CHARS = 160;

/** The colour allowlist — see `isSafeSettingColor` for what each part of the set is for. */
const SAFE_COLOR = /^[\w#(),.%\s-]{1,64}$/u;

/** As long as a settings row can show without wrapping into the next field. */
const MAX_SETTING_LABEL_CHARS = 80;

/**
 * Cut to the cap without splitting a character in half.
 *
 * `slice` counts UTF-16 code units, so a value ending on an astral character — an emoji, a
 * rarer CJK ideograph — would hand the plugin a lone surrogate (§260 Phase 4c code review,
 * N12). Dropping the orphan costs one character and keeps the string well-formed.
 */
function clampChars(value: string): string {
  if (value.length <= MAX_SETTING_VALUE_CHARS) return value;
  const cut = value.slice(0, MAX_SETTING_VALUE_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  const isLoneHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return isLoneHighSurrogate ? cut.slice(0, -1) : cut;
}

/**
 * `undefined` for anything that is not a usable value of `field`.
 *
 * Takes the whole FIELD, not just its type, because §0054's constraints live on the field:
 * a number's `min`/`max`, an enum's `options`. Every one of them refuses the same way a type
 * mismatch does, so `resolveOne`'s persisted → default → zero chain needs no new branch —
 * which also means a declared `default` outside its own `min`/`max` is skipped rather than
 * handed over. The validator rejects that manifest at install; this keeps a hand-edited one
 * from getting a value its own field says is illegal.
 */
function coerce(
  value: unknown,
  field: Pick<PluginSettingField, "max" | "min" | "options" | "type">,
): PluginSettingValue | undefined {
  const { type } = field;
  // ‼️ `SETTING_VALUE_TYPES[type]`, not `type`: `color` and `enum` are carried as strings,
  // and comparing `typeof value` against the DECLARED name would refuse every value they
  // ever hold. See that table's comment.
  if (typeof value !== SETTING_VALUE_TYPES[type]) return undefined;
  if (type === "number") {
    const n = value as number;
    if (!Number.isFinite(n)) return undefined;
    if (field.min !== undefined && n < field.min) return undefined;
    if (field.max !== undefined && n > field.max) return undefined;
    return n;
  }
  if (type === "enum") {
    // Membership, not shape: an `options` list the validator refused cannot reach here for an
    // installed plugin, and `isUsableField` drops such a field from `declaredSettingsFor`.
    return field.options?.some((o) => o.value === value)
      ? (value as string)
      : undefined;
  }
  if (type === "color") {
    // Trimmed, not just tested: `isSafeSettingColor` trims before matching, so returning the
    // raw string would let `" red "` pass a check its own value never took.
    const trimmed = (value as string).trim();
    return isSafeSettingColor(trimmed) ? trimmed : undefined;
  }
  // ‼️ `string` NAMED, not left as the fallthrough. Writing this as a trailing
  // `return clampChars(value as string)` typechecks — the cast hides it — and sent every
  // BOOLEAN through a string clamp, where `value.slice` is not a function. The existing
  // sandbox tests caught it; the cast is why the compiler did not.
  if (type === "string") return clampChars(value as string);
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
  if (
    typeof field?.key !== "string" ||
    field.key.length === 0 ||
    typeof field.label !== "string" ||
    !SETTING_TYPES.includes(field.type)
  ) {
    return false;
  }
  // §0054 — two shapes that would render a control the user cannot answer. Dropped rather
  // than repaired, the same way a missing `label` is: the field is gone from the form AND
  // from what the plugin is told, so the two can never disagree about which fields exist.
  //
  // An `enum` with no usable option renders an empty `<select>`, and its resolved value
  // would have to be the `""` that `zeroFor` reserves for exactly this unreachable case.
  if (field.type === "enum" && !field.options?.some(isUsableOption))
    return false;
  // A range that admits nothing. Every value coerces away, so the form would show a number
  // the field itself calls illegal — and `ZERO.number` is `0`, which is outside most such
  // ranges too. The validator refuses this manifest at install; a hand-edited one gets here.
  if (
    field.min !== undefined &&
    field.max !== undefined &&
    field.min > field.max
  ) {
    return false;
  }
  return true;
}

function isUsableOption(option: PluginSettingOption): boolean {
  return typeof option?.value === "string" && typeof option.label === "string";
}

function resolveOne(
  field: PluginSettingField,
  persisted: unknown,
): PluginSettingValue {
  return (
    coerce(persisted, field) ?? coerce(field.default, field) ?? zeroFor(field)
  );
}

/**
 * The value a field falls back to when neither the persisted record nor the declared
 * `default` yields a usable one.
 *
 * `enum` cannot use the table: its zero is not a constant but the field's own first option,
 * which is the only value that keeps this function's promise — one value per declared field,
 * and for an enum always one of `options`. `?? ""` for a field whose options are unusable;
 * `declaredSettingsFor` drops those, so that arm is reachable only by calling this exported
 * function with a raw manifest field.
 */
function zeroFor(field: PluginSettingField): PluginSettingValue {
  if (field.type === "enum") return field.options?.[0]?.value ?? "";
  // `?? ""` because `ZERO[type]` is `undefined` for a type outside the set, and an
  // `undefined` here is DROPPED by `JSON.stringify` on the way to the sandbox (§260
  // Phase 4c code review, M5) — which would break the one promise this API makes, stated
  // in `SandboxSettingsAPI` and in the plugin guide: one value per declared field. The
  // callers all pass `declaredSettingsFor` output, which filters such a field out
  // already; this makes the exported function safe on its own rather than by luck.
  return ZERO[field.type] ?? "";
}

/**
 * `transparent` rather than `""` for a colour (§0054).
 *
 * This is only reached by a manifest that declares a `color` field and gives it no usable
 * `default` — an author bug. `""` would be the parallel of the other zeros, but the value's
 * destination is a stylesheet, where an empty string makes the declaration invalid and the
 * failure surfaces as "the rule did nothing" with no way to tell it from a selector that did
 * not match. `transparent` is a real CSS colour that renders as the author's omission looks.
 *
 * The `enum` entry is required by the `Record` and never read — `zeroFor` answers that type
 * from the field's own `options` before reaching here.
 */
const ZERO: Record<PluginSettingField["type"], PluginSettingValue> = {
  boolean: false,
  color: "transparent",
  enum: "",
  number: 0,
  string: "",
};

// §260 Phase 4c — the value model. What is PERSISTED and what a plugin is TOLD are
// different things, and every case below is a way the two can disagree.
import type { PluginSettingField, PluginSettingOption } from "../types";

import { describe, expect, it } from "vitest";

import {
  declaredSettingsFor,
  MAX_SETTING_FIELDS,
  MAX_SETTING_VALUE_CHARS,
  resolvePluginSettings,
  sanitizeSettingDescription,
  sanitizeSettingLabel,
} from "../plugin-settings";

const declared: PluginSettingField[] = [
  { default: true, key: "compact", label: "Compact", type: "boolean" },
  { default: 3, key: "depth", label: "Depth", type: "number" },
  { default: "»", key: "prefix", label: "Prefix", type: "string" },
];

describe("resolvePluginSettings", () => {
  it("prefers a persisted value of the declared type", () => {
    expect(
      resolvePluginSettings(declared, {
        compact: false,
        depth: 7,
        prefix: "→",
      }),
    ).toEqual({ compact: false, depth: 7, prefix: "→" });
  });

  it("falls back to the declared default, then to the type's zero", () => {
    expect(resolvePluginSettings(declared, {})).toEqual({
      compact: true,
      depth: 3,
      prefix: "»",
    });
    // A field with no default still has a value, so plugin code needs no `undefined`
    // branch for something its own manifest declares.
    expect(
      resolvePluginSettings(
        [
          { key: "on", label: "On", type: "boolean" },
          { key: "n", label: "N", type: "number" },
          { key: "s", label: "S", type: "string" },
        ],
        undefined,
      ),
    ).toEqual({ n: 0, on: false, s: "" });
  });

  it("ignores a persisted value whose type contradicts the manifest", () => {
    // The case this exists for: a plugin UPDATE changes a field's type. Handing over the
    // old value would make `value.toFixed()` throw inside the sandbox, where the author
    // cannot see it.
    expect(
      resolvePluginSettings(declared, {
        compact: "yes",
        depth: "7",
        prefix: 42,
      }),
    ).toEqual({ compact: true, depth: 3, prefix: "»" });
  });

  it("drops keys the manifest no longer declares", () => {
    // Otherwise a renamed key's stale value resurfaces under the old name, and the
    // payload is bounded by the persisted file rather than by the manifest.
    const resolved = resolvePluginSettings(declared, {
      depth: 9,
      removedInV2: "still here",
    });
    expect(Object.keys(resolved)).toEqual(["compact", "depth", "prefix"]);
    expect(resolved).not.toHaveProperty("removedInV2");
  });

  it("keeps declaration order, so the form and the payload agree", () => {
    expect(
      Object.keys(resolvePluginSettings(declared, { prefix: "x" })),
    ).toEqual(["compact", "depth", "prefix"]);
  });

  it("refuses a non-finite number", () => {
    // `JSON.parse` cannot produce NaN, but the persisted config is a file the user can
    // edit and `1e999` parses to Infinity.
    expect(
      resolvePluginSettings(declared, { depth: Number.POSITIVE_INFINITY })
        .depth,
    ).toBe(3);
    expect(resolvePluginSettings(declared, { depth: Number.NaN }).depth).toBe(
      3,
    );
  });

  it("clamps a string to the cap that makes the payload bounded", () => {
    const long = "x".repeat(MAX_SETTING_VALUE_CHARS + 100);
    expect(
      resolvePluginSettings(declared, { prefix: long }).prefix,
    ).toHaveLength(MAX_SETTING_VALUE_CHARS);
  });

  it("does NOT strip control characters from a value", () => {
    // Deliberate: the destination is the plugin, and every path that renders
    // plugin-supplied text in the app's chrome sanitises at its own boundary. Stripping
    // here would only make the value differ from what the user typed.
    expect(resolvePluginSettings(declared, { prefix: "a\nb" }).prefix).toBe(
      "a\nb",
    );
  });

  it("gives a `__proto__` field a real value instead of swallowing it", () => {
    // §260 Phase 4c security review (LOW-3): `CONTRIBUTION_ID` admits `__proto__`, and
    // `plain["__proto__"] = true` hits the inherited SETTER, which ignores a primitive — so
    // the key vanished, the read came back as `Object.prototype`, and a boolean field
    // rendered permanently unchecked while the user's toggle went nowhere.
    const resolved = resolvePluginSettings(
      [{ default: true, key: "__proto__", label: "P", type: "boolean" }],
      undefined,
    );
    expect(resolved["__proto__"]).toBe(true);
    expect(Object.keys(resolved)).toEqual(["__proto__"]);
    // …and a persisted `__proto__`/`constructor` still cannot pollute anything: `coerce`
    // only ever yields a primitive of the declared type.
    expect(
      resolvePluginSettings(declared, {
        __proto__: { polluted: true },
        constructor: "x",
      }).depth,
    ).toBe(3);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("never omits a declared key, even for a type outside the set", () => {
    // §260 Phase 4c code review (M5) — `ZERO[type]` is `undefined` for an unknown type, and
    // `JSON.stringify` DROPS an undefined value, so the key would vanish from the staged
    // payload. That breaks the one promise this API makes ("one value per declared field",
    // stated in `SandboxSettingsAPI` and the plugin guide). The exported resolver has to
    // hold that on its own: its callers only happen to pass filtered fields.
    const resolved = resolvePluginSettings(
      [{ key: "odd", label: "Odd", type: "object" as never }],
      undefined,
    );
    expect(Object.keys(resolved)).toEqual(["odd"]);
    expect(JSON.parse(JSON.stringify(resolved))).toEqual({ odd: "" });
  });

  it("clamps without splitting a character in half", () => {
    // N12 — `slice` counts UTF-16 code units, so cutting on an astral character handed the
    // plugin a lone surrogate.
    //
    // ‼️ The leading "a" is what makes this test able to fail: the cap is EVEN and an emoji
    // is two code units, so an all-emoji string is cut exactly on a boundary and passes
    // either way. Mutation testing caught that — the first version of this test was green
    // against the unfixed slice. One odd character ahead of them moves every pair off the
    // boundary.
    const emoji = "🙂";
    const value = `a${emoji.repeat(MAX_SETTING_VALUE_CHARS)}`;

    const clamped = resolvePluginSettings(declared, { prefix: value })
      .prefix as string;

    // One short of the cap: the pair that straddled it was dropped whole.
    expect(clamped).toHaveLength(MAX_SETTING_VALUE_CHARS - 1);
    expect(clamped).toBe(`a${emoji.repeat((MAX_SETTING_VALUE_CHARS - 2) / 2)}`);
    // The real property, stated directly: no unpaired surrogate survived the cut.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(clamped)).toBe(false);
  });

  it("resolves nothing when nothing is declared", () => {
    expect(resolvePluginSettings(undefined, { stray: 1 })).toEqual({});
  });
});

describe("declaredSettingsFor", () => {
  const withFields = (settings: unknown, capabilities = ["settings"]) =>
    declaredSettingsFor({
      capabilities,
      contributions: { settings },
    } as never);

  it("returns the declared fields when the capability is held", () => {
    expect(withFields(declared)).toEqual(declared);
    expect(withFields(declared, ["commands"])).toEqual([]);
  });

  it("skips a field the CURRENT validator would reject", () => {
    // The manifest here comes from the STORE, which outlives the validator that admitted
    // it: a plugin installed before a field's rule existed keeps its record in
    // `installedPlugins` even when the load now fails, and the form reads that record.
    // `"settings": [{}]` used to render a row labelled `undefined` writing to the key
    // `"undefined"`.
    expect(
      withFields([
        {},
        { key: "", label: "empty", type: "string" },
        { key: "ok", label: "Ok", type: "string" },
        { key: "weird", label: "Weird", type: "object" },
      ]),
    ).toEqual([{ key: "ok", label: "Ok", type: "string" }]);
  });

  it("survives every manifest shape that used to CRASH the app", () => {
    // §260 Phase 4c security review (MEDIUM-1). The record is written on the INSTALL path
    // (`addPlugin`) before `loadPlugin` validates anything, and a failed load is caught and
    // turned into an error badge — the record stays. The app's only error boundary is the
    // root one, so a throw while rendering a row replaced the WHOLE APP with the error UI,
    // every time Settings → Plugins was opened, on the route that holds Uninstall.
    expect(withFields("AAAA")).toEqual([]); // not an array at all
    expect(withFields({ a: 1 })).toEqual([]);
    expect(withFields(undefined)).toEqual([]);
    // A missing or non-string label reached `sanitizeSettingLabel` → `raw.replace`.
    expect(withFields([{ key: "k", type: "string" }])).toEqual([]);
    expect(withFields([{ key: "k", label: 42, type: "string" }])).toEqual([]);
  });

  it("caps the field count where the untrusted record is READ", () => {
    // The validator's cap only guards the load path; 5,000 declared fields rendered 5,000
    // inputs.
    const many = Array.from({ length: MAX_SETTING_FIELDS + 40 }, (_, i) => ({
      key: `k${i}`,
      label: "L",
      type: "string",
    }));
    expect(withFields(many)).toHaveLength(MAX_SETTING_FIELDS);
  });

  it("keeps the FIRST of two fields sharing a key", () => {
    // Two controls driving one value is what the duplicate-key validation prevents at
    // install; a record written before that rule can still hold one.
    expect(
      withFields([
        { default: 1, key: "n", label: "First", type: "number" },
        { default: 2, key: "n", label: "Second", type: "number" },
      ]),
    ).toEqual([{ default: 1, key: "n", label: "First", type: "number" }]);
  });
});

describe("sanitizeSettingLabel", () => {
  it("flattens a label that would break the settings row", () => {
    // A label IS rendered in the app's own chrome, so unlike a value it is sanitised.
    expect(sanitizeSettingLabel("Two\nlines")).toBe("Two lines");
    expect(sanitizeSettingLabel("x".repeat(200))).toHaveLength(80);
  });
});

// §0054 — the constraints a field may now carry, and the two new types.
//
// ‼️ Every case below is a value the resolver must REFUSE and replace. What makes that worth
// asserting rather than assuming: the persisted record is a config file the user can edit, and
// before §0054 a bound existed only inside the plugin (`css.ts`'s 0.5–8 clamp on `lineWidth`),
// so typing `100` produced the default with nothing anywhere saying why.
describe("field constraints (§0054)", () => {
  const width: PluginSettingField = {
    default: 2,
    key: "w",
    label: "Width",
    max: 8,
    min: 0.5,
    type: "number",
  };
  const marker: PluginSettingField = {
    default: "halo",
    key: "m",
    label: "Marker",
    options: [
      { label: "Halo", value: "halo" },
      { label: "Filled", value: "filled" },
      { label: "None", value: "none" },
    ],
    type: "enum",
  };
  const colour: PluginSettingField = {
    default: "var(--color-accent-default)",
    key: "c",
    label: "Colour",
    type: "color",
  };

  describe("min/max", () => {
    it("takes a persisted value inside the range", () => {
      // The positive half: without it, "refuses 100" would also pass on a resolver that
      // refused everything.
      expect(resolvePluginSettings([width], { w: 4 })).toEqual({ w: 4 });
      // Inclusive at both ends.
      expect(resolvePluginSettings([width], { w: 0.5 })).toEqual({ w: 0.5 });
      expect(resolvePluginSettings([width], { w: 8 })).toEqual({ w: 8 });
    });

    it("falls back to the default outside it, like a type mismatch", () => {
      expect(resolvePluginSettings([width], { w: 100 })).toEqual({ w: 2 });
      expect(resolvePluginSettings([width], { w: 0 })).toEqual({ w: 2 });
    });

    it("skips a DEFAULT outside its own range and reaches the zero", () => {
      // A hand-edited manifest; the validator refuses this one at install. `0` is
      // `ZERO.number` — itself outside the range, which is why the validator has to refuse
      // the manifest rather than this being the whole answer.
      const broken = { ...width, default: 99 };
      expect(resolvePluginSettings([broken], {})).toEqual({ w: 0 });
    });

    it("drops a field whose range admits nothing", () => {
      // Every value coerces away, so the form would show a number the field calls illegal.
      expect(
        declaredSettingsFor({
          capabilities: ["settings"],
          contributions: { settings: [{ ...width, max: 1, min: 5 }] },
        }),
      ).toEqual([]);
    });
  });

  describe("enum", () => {
    it("takes a persisted value that is one of the options", () => {
      expect(resolvePluginSettings([marker], { m: "filled" })).toEqual({
        m: "filled",
      });
    });

    it("refuses a value no option declares", () => {
      // A renamed option in a plugin update leaves the old answer in the record.
      expect(resolvePluginSettings([marker], { m: "glow" })).toEqual({
        m: "halo",
      });
    });

    it("falls back to the FIRST option when the default is unusable too", () => {
      // ‼️ Not `""`. The promise is one value per field, and for an enum always one of
      // `options` — `""` is in none of them, and a plugin switching on the value would hit
      // its own unreachable branch.
      const broken = { ...marker, default: "gone" };
      expect(resolvePluginSettings([broken], {})).toEqual({ m: "halo" });
    });

    it("drops a field with no usable options", () => {
      expect(
        declaredSettingsFor({
          capabilities: ["settings"],
          contributions: { settings: [{ ...marker, options: [] }] },
        }),
      ).toEqual([]);
      expect(
        declaredSettingsFor({
          capabilities: ["settings"],
          contributions: {
            // Cast because the TYPE forbids this and a hand-edited manifest does not —
            // which is the whole reason `declaredSettingsFor` re-checks what the validator
            // already checked. See its own comment on the install/load gap.
            settings: [
              { ...marker, options: [{ value: "x" } as PluginSettingOption] },
            ],
          },
        }),
      ).toEqual([]);
    });
  });

  describe("color", () => {
    it("keeps the shapes a colour actually takes", () => {
      for (const value of [
        "#3b82f6",
        "rebeccapurple",
        "rgb(59, 130, 246)",
        "rgba(59,130,246,0.5)",
        "var(--color-status-danger)",
        "color-mix(in srgb, red 50%, blue)",
      ]) {
        expect(resolvePluginSettings([colour], { c: value })).toEqual({
          c: value,
        });
      }
    });

    it("refuses a string that could end the declaration it is pasted into", () => {
      // The plugin builds a stylesheet from this. Its own check stays — this is the type
      // keeping its promise, not a replacement for the plugin's guard.
      for (const value of [
        "red; } body { display: none",
        "url(http://x/y)",
        "@import 'x'",
        "x".repeat(100),
        "   ",
      ]) {
        expect(resolvePluginSettings([colour], { c: value })).toEqual({
          c: "var(--color-accent-default)",
        });
      }
    });

    it("trims, so the stored value is the one that passed the check", () => {
      expect(resolvePluginSettings([colour], { c: "  red  " })).toEqual({
        c: "red",
      });
    });

    it("falls back to transparent when the field declares no usable default", () => {
      // An author bug, and `""` would make the declaration invalid — indistinguishable from
      // a selector that never matched.
      const broken = { ...colour, default: undefined };
      expect(resolvePluginSettings([broken], {})).toEqual({ c: "transparent" });
    });
  });
});

describe("sanitizeSettingDescription", () => {
  it("flattens and caps a description, on its own longer bound", () => {
    // Longer than a label because it holds the sentence that used to live in the README.
    expect(sanitizeSettingDescription("Two\nlines")).toBe("Two lines");
    expect(sanitizeSettingDescription("x".repeat(400))).toHaveLength(160);
  });
});

// §0054 code review (HIGH) — a PARTLY malformed options list.
//
// ‼️ `isUsableField` gated on `.some(isUsableOption)` — one good option was enough — while
// both consumers walk EVERY option: the form maps all of them, and `coerce` compares against
// all of them. So a list with one good entry and one bad one survived the gate and then threw
// on the bad one, during render, which at the root error boundary replaces the whole app on
// the very route that holds Uninstall.
//
// The comment above that gate asserted the opposite ("an `options` list the validator refused
// cannot reach here"), which is what stopped the gap being seen. Universal quantifier,
// unverified — the exact shape CLAUDE.md 「주석·문서의 주장」 is about.
describe("a partly malformed enum (§0054 review, HIGH)", () => {
  const mixed = (options: unknown[]) => ({
    capabilities: ["settings"],
    contributions: {
      settings: [{ default: "a", key: "m", label: "M", options, type: "enum" }],
    },
  });

  it("drops a field where ANY option is unusable, not just where all are", () => {
    for (const options of [
      [{ label: "A", value: "a" }, null],
      [
        { label: "A", value: "a" },
        { label: 42, value: "b" },
      ],
      [
        { label: "A", value: "a" },
        { label: "B", value: 99 },
      ],
      [{ label: "A", value: "a" }, "b"],
    ]) {
      expect(
        declaredSettingsFor(mixed(options) as never),
        `options ${JSON.stringify(options)} must drop the field`,
      ).toEqual([]);
    }
  });

  it("still keeps a wholly well-formed list — the gate is not just 'refuse everything'", () => {
    expect(
      declaredSettingsFor(
        mixed([
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ]) as never,
      ),
    ).toHaveLength(1);
  });

  it("refuses an option value long enough to break the stated payload bound", () => {
    // `MAX_SETTING_VALUE_CHARS`'s comment argues the transport decision from
    // "16 × 512 is ~9 KiB". An enum value is never clamped — `clampChars` runs for `string`
    // only — so an unbounded option value made that a stated bound that is not a bound.
    expect(
      declaredSettingsFor(
        mixed([
          { label: "A", value: "a".repeat(MAX_SETTING_VALUE_CHARS + 1) },
        ]) as never,
      ),
    ).toEqual([]);
  });

  it("never yields a non-string for a declared enum, even from a raw field", () => {
    // `resolvePluginSettings` is exported and takes fields directly, so it has to hold this
    // on its own: `zeroFor` read `options[0]` without the check that decided the field
    // survives, so a first option with a numeric `value` reached plugin code as a number.
    const resolved = resolvePluginSettings(
      [
        {
          key: "m",
          label: "M",
          options: [
            { label: "x", value: 99 },
            { label: "B", value: "b" },
          ],
          type: "enum",
        } as never,
      ],
      {},
    );
    expect(typeof resolved.m).toBe("string");
    expect(resolved.m).toBe("b");
  });
});

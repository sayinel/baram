// §260 Phase 4c — the value model. What is PERSISTED and what a plugin is TOLD are
// different things, and every case below is a way the two can disagree.
import type { PluginSettingField } from "../types";

import { describe, expect, it } from "vitest";

import {
  declaredSettingsFor,
  MAX_SETTING_FIELDS,
  MAX_SETTING_VALUE_CHARS,
  resolvePluginSettings,
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

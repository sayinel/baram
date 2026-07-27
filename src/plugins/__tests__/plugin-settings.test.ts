// §260 Phase 4c — the value model. What is PERSISTED and what a plugin is TOLD are
// different things, and every case below is a way the two can disagree.
import type { PluginSettingField } from "../types";

import { describe, expect, it } from "vitest";

import {
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

  it("resolves nothing when nothing is declared", () => {
    expect(resolvePluginSettings(undefined, { stray: 1 })).toEqual({});
  });
});

describe("sanitizeSettingLabel", () => {
  it("flattens a label that would break the settings row", () => {
    // A label IS rendered in the app's own chrome, so unlike a value it is sanitised.
    expect(sanitizeSettingLabel("Two\nlines")).toBe("Two lines");
    expect(sanitizeSettingLabel("x".repeat(200))).toHaveLength(80);
  });
});

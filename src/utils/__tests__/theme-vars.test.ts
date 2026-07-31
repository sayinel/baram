import type { ThemeColors } from "../../types/theme";

// §54 / #330 — theme variables are applied and cleared through one module so a
// colour and the foreground derived from it can never be written out of step.
import { beforeEach, describe, expect, it } from "vitest";

import { BUILT_IN_THEMES, THEME_COLOR_KEYS } from "../../types/theme";
import {
  applyThemeVars,
  clearThemeVars,
  DERIVED_ACCENT_KEYS,
} from "../theme-vars";

const NORD = BUILT_IN_THEMES.find((t) => t.id === "nord")!;
const SOLARIZED_LIGHT = BUILT_IN_THEMES.find(
  (t) => t.id === "solarized-light",
)!;

function inlineKeys(root: HTMLElement): string[] {
  return Array.from({ length: root.style.length }, (_, i) =>
    root.style.item(i),
  );
}

describe("THEME_COLOR_KEYS", () => {
  it("covers every ThemeColors key", () => {
    // clearThemeVars derives its removal list from this array. The hand-written
    // list it replaced had drifted to 16 of 25 keys, leaving nine overrides behind
    // on a switch back to a default theme — so the array being complete IS the fix.
    const declared = THEME_COLOR_KEYS.map((entry) => entry.key).sort();
    const actual = (Object.keys(NORD.colors) as (keyof ThemeColors)[]).sort();
    expect(declared).toEqual(actual);
  });

  it("does not offer the derived keys as user-editable colours", () => {
    // Letting a user pick these would let them save a failing pairing.
    for (const key of DERIVED_ACCENT_KEYS) {
      expect(THEME_COLOR_KEYS.map((e) => e.key)).not.toContain(key);
    }
  });
});

describe("applyThemeVars", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
  });

  it("writes every theme colour", () => {
    applyThemeVars(root, NORD.colors, NORD.base);
    for (const [key, value] of Object.entries(NORD.colors)) {
      expect(root.style.getPropertyValue(key)).toBe(value);
    }
  });

  it("writes the derived accent pairing alongside the colours", () => {
    applyThemeVars(root, NORD.colors, NORD.base);
    // Nord's pale cyan accent takes dark text — white on it is 2.00:1.
    expect(root.style.getPropertyValue("--color-accent-solid")).toBe("#88c0d0");
    expect(root.style.getPropertyValue("--color-accent-on-solid")).toBe(
      "#000000",
    );
    expect(root.style.getPropertyValue("--color-accent-solid-hover")).not.toBe(
      "",
    );
  });

  it("derives from the base it is given, not from the colours alone", () => {
    // Same palette, different base: the light reading steps the fill to the
    // palette's darker blue so white text can stay.
    applyThemeVars(root, SOLARIZED_LIGHT.colors, "light");
    expect(root.style.getPropertyValue("--color-accent-solid")).toBe("#1a6fb5");
    expect(root.style.getPropertyValue("--color-accent-on-solid")).toBe(
      "#ffffff",
    );

    applyThemeVars(root, SOLARIZED_LIGHT.colors, "dark");
    expect(root.style.getPropertyValue("--color-accent-solid")).toBe("#268bd2");
    expect(root.style.getPropertyValue("--color-accent-on-solid")).toBe(
      "#000000",
    );
  });
});

describe("clearThemeVars", () => {
  it("removes everything applyThemeVars can set", () => {
    const root = document.createElement("div");
    applyThemeVars(root, NORD.colors, NORD.base);
    expect(inlineKeys(root).length).toBeGreaterThan(0);

    clearThemeVars(root);
    expect(inlineKeys(root)).toEqual([]);
  });

  it("leaves no accent override behind when switching to a default theme", () => {
    // The regression this pairing of functions exists to prevent: a stale
    // --color-accent-solid would keep overriding the default theme's cascade.
    const root = document.createElement("div");
    applyThemeVars(root, NORD.colors, NORD.base);
    clearThemeVars(root);
    for (const key of DERIVED_ACCENT_KEYS) {
      expect(root.style.getPropertyValue(key)).toBe("");
    }
    expect(root.style.getPropertyValue("--color-accent-default")).toBe("");
    // A key the old 16-entry list omitted.
    expect(root.style.getPropertyValue("--color-accent-subtle")).toBe("");
    expect(root.style.getPropertyValue("--color-status-danger")).toBe("");
  });
});

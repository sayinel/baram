// §54 / #330 — the shipped token values must clear WCAG AA, not just the runtime
// derivation. `npm run audit:css-vars` only reports *undefined* variables, so
// nothing else in the repo would notice a token edited into a failing pairing.
//
// These files also cover the two cases that apply no inline overrides at all: the
// default themes and `system` (which follows prefers-color-scheme).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BUILT_IN_THEMES } from "../../types/theme";
import { AA_TEXT_RATIO, contrastRatio } from "../color-contrast";
import { derivedVars } from "../theme-vars";

const GENERATED = "src/styles/generated";

/** `--name: value;` pairs from a generated file, last declaration winning. */
function declarations(file: string): Map<string, string> {
  const css = readFileSync(`${GENERATED}/${file}`, "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const found = new Map<string, string>();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    // Prettier wraps long declarations, so `var(--x)` arrives across three lines.
    found.set(name, value.replace(/\s+/g, " ").trim());
  }
  return found;
}

const PRIMITIVES = declarations("primitives.css");

/** The accent trio from one generated file, resolved to hex. */
function accentTrio(file: string): {
  hover: string;
  onSolid: string;
  solid: string;
} {
  const tokens = declarations(file);
  const read = (name: string): string => {
    const value = tokens.get(name);
    if (value === undefined) throw new Error(`${name} missing from ${file}`);
    return resolve(value);
  };
  return {
    hover: read("--color-accent-solid-hover"),
    onSolid: read("--color-accent-on-solid"),
    solid: read("--color-accent-solid"),
  };
}

/**
 * Resolve a token value down to a hex literal, following `var()` indirection.
 *
 * Normalised to six lowercase digits because prettier runs over these generated
 * files on commit and shortens `#ffffff` to `#fff` — an equality assertion on the
 * raw text would pass here and fail in CI.
 */
function resolve(value: string): string {
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  if (ref) {
    const target = PRIMITIVES.get(ref[1]);
    if (target === undefined) {
      throw new Error(`${ref[1]} is not defined in primitives.css`);
    }
    return resolve(target);
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!hex) throw new Error(`not a hex literal: ${value}`);
  const digits = hex[1].toLowerCase();
  return `#${digits.length === 3 ? digits.replace(/./g, (c) => c + c) : digits}`;
}

describe.each([
  ["semantic-light.css", "default-light"],
  ["semantic-dark.css", "default-dark"],
  ["system-dark.css", "default-dark"],
])("%s", (file, themeId) => {
  it("pairs accent-on-solid with accent-solid above AA", () => {
    const { onSolid, solid } = accentTrio(file);
    expect(contrastRatio(onSolid, solid)!).toBeGreaterThanOrEqual(
      AA_TEXT_RATIO,
    );
  });

  it("keeps that pairing above AA on hover", () => {
    const { hover, onSolid, solid } = accentTrio(file);
    const base = contrastRatio(onSolid, solid)!;
    expect(contrastRatio(onSolid, hover)!).toBeGreaterThanOrEqual(base);
    expect(contrastRatio(onSolid, hover)!).toBeGreaterThanOrEqual(
      AA_TEXT_RATIO,
    );
  });

  it("agrees with what the runtime would derive for the same theme", () => {
    // Two code paths decide this pairing: these static tokens for the default and
    // `system` themes, and derivedVars for every explicitly-chosen theme.
    // If they disagreed, switching between a default and a custom theme would
    // change the button's colours for no reason the user can see.
    const theme = BUILT_IN_THEMES.find((t) => t.id === themeId)!;
    const derived = derivedVars(theme.colors, theme.base);
    const { onSolid, solid } = accentTrio(file);
    expect(solid).toBe(derived["--color-accent-solid"]);
    expect(onSolid).toBe(derived["--color-accent-on-solid"]);
    // solid-hover is deliberately NOT asserted equal: the tokens step through the
    // palette (blue-700 / blue-300) while the runtime has no palette to step
    // through and shifts the fill numerically. Both satisfy the hover invariant
    // above, which is the property that matters.
  });
});

describe.each([
  ["semantic-light.css", "default-light"],
  ["semantic-dark.css", "default-dark"],
  ["system-dark.css", "default-dark"],
])("%s status families", (file, themeId) => {
  const FAMILIES = ["danger", "success", "warning"] as const;

  it.each(FAMILIES)("pairs %s with a foreground above AA", (family) => {
    const tokens = declarations(file);
    const fill = tokens.get(`--color-status-${family}`);
    const onSolid = tokens.get(`--color-status-${family}-on-solid`);
    if (fill === undefined || onSolid === undefined) {
      throw new Error(
        `--color-status-${family}[-on-solid] missing from ${file}`,
      );
    }
    expect(
      contrastRatio(resolve(onSolid), resolve(fill))!,
    ).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
  });

  it.each(FAMILIES)("keeps %s above AA on hover", (family) => {
    const tokens = declarations(file);
    const fill = tokens.get(`--color-status-${family}`);
    const hover = tokens.get(`--color-status-${family}-solid-hover`);
    const onSolid = tokens.get(`--color-status-${family}-on-solid`);
    if (!fill || !hover || !onSolid) {
      throw new Error(`--color-status-${family}-* missing from ${file}`);
    }
    const rest = contrastRatio(resolve(onSolid), resolve(fill))!;
    const hovered = contrastRatio(resolve(onSolid), resolve(hover))!;
    expect(hovered).toBeGreaterThanOrEqual(rest);
    expect(hovered).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
  });

  it("agrees with what the runtime would derive", () => {
    const theme = BUILT_IN_THEMES.find((t) => t.id === themeId)!;
    const derived = derivedVars(theme.colors, theme.base);
    const tokens = declarations(file);
    for (const family of FAMILIES) {
      const key = `--color-status-${family}-on-solid`;
      expect(resolve(tokens.get(key)!)).toBe(derived[key]);
    }
  });
});

describe("light and dark disagree about the foreground", () => {
  it("proves a single static pairing could not serve both", () => {
    // The reason this is derived rather than hardcoded, asserted on the shipped
    // values: the light theme's fill needs white and the dark theme's needs black.
    expect(accentTrio("semantic-light.css").onSolid).toBe("#ffffff");
    expect(accentTrio("semantic-dark.css").onSolid).toBe("#000000");
  });
});

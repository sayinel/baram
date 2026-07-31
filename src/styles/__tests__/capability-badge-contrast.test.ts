// The capability badge's derived tint pairing must clear AA for every capability, in
// both bases (#330).
//
// The badge painted a capability's hue as its own text on a 9% tint of itself. A 9%
// tint is 91% whatever is behind it, so the pairing was really hue-vs-page and failed
// AA in 74 of 96 capability x built-in-theme combinations — all twelve in every light
// theme, and seven of the twelve in EVERY theme including `network`.
//
// Both sides are now opaque `color-mix()` results, so the ratio is a property of the
// hue and the base alone: no page colour, custom theme or user `--color-bg-*` edit can
// move it. This file is what makes that claim checkable — it reads the recipe out of
// the SHIPPED stylesheet and the hues out of the SHIPPED component rather than
// restating either, so a value edited in one place cannot leave the guard measuring
// the old one.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CAPABILITY_DESCRIPTIONS } from "../../plugins/types";
import { AA_TEXT_RATIO, contrastRatio } from "../../utils/color-contrast";

/** Every capability that exists, from the map whose keys are the validation allowlist. */
const CAPABILITIES = Object.keys(CAPABILITY_DESCRIPTIONS);

/**
 * Deliberately stricter than AA, and the reason is `mix()` below.
 *
 * `color-mix()` interpolates in floats and the browser composites at more than 8 bits;
 * this file models it in whole channels. The error is under 1/255, which is nothing to
 * a ratio — unless the ratio sits 0.03 above the line, which is what the loosest
 * passing percentages (57%/93%) produce. Requiring headroom means a green run here
 * cannot be an artefact of where the model rounds. Relationship to AA is asserted, so
 * this cannot be quietly lowered to meet a failing pairing.
 */
const MIN_RATIO = 4.75;

const CSS = readFileSync(
  resolve(__dirname, "../plugins.css"),
  "utf8",
).replaceAll(/\s+/gu, " ");

const TSX = readFileSync(
  resolve(__dirname, "../../components/plugins/PluginCapabilityBadge.tsx"),
  "utf8",
);

/** The three scopes that set the recipe, keyed by the selector each one uses. */
const SCOPES = {
  dark: '[data-theme="dark"]',
  light: ":root",
  system: 'html:not([data-theme="light"], [data-theme="dark"])',
} as const;

describe("the badge's own maths", () => {
  // The assertions below are only as good as this function, which stands in for the
  // browser's `color-mix(in srgb, ...)`. Pinned against values that can be checked by
  // hand, so a broken mix cannot quietly turn every ratio green.
  it("replicates color-mix(in srgb, A p%, B)", () => {
    // Percentages chosen to land on whole channels, so these pin the direction and the
    // magnitude without also pinning a rounding convention the browser does not share.
    expect(mix("#000000", 50, "#ffffff")).toBe("#808080");
    expect(mix("#000000", 20, "#ffffff")).toBe("#cccccc");
    expect(mix("#ffffff", 20, "#000000")).toBe("#333333");
    expect(mix("#ff0000", 100, "#0000ff")).toBe("#ff0000");
    expect(mix("#ff0000", 0, "#0000ff")).toBe("#0000ff");
    // stylelint's `--fix` shortens the recipe's `#ffffff`/`#000000` to `#fff`/`#000`.
    // Without expansion the channel slices read `"ff"`, `"f"`, `""`, so a mixed colour
    // came out `#NaN…` and every ratio came out unparseable. This file's first green
    // run held only on the pre-format text, which is the failure it now pins.
    expect(mix("#fff", 50, "#000")).toBe("#808080");
  });

  it("demands more than AA, so rounding cannot decide a pass", () => {
    expect(MIN_RATIO).toBeGreaterThan(AA_TEXT_RATIO);
  });

  it("reads a hue for every capability that exists", () => {
    // The union gained `viewer` in v0.5.0 while this map kept twelve entries, so
    // viewer resolved to the `settings` grey and the two were indistinguishable. The
    // annotation is `Record<PluginCapability, string>` now, but a widened type would
    // compile again — this fails on the missing entry either way.
    expect(Object.keys(hues()).sort()).toEqual([...CAPABILITIES].sort());
  });

  it("reads a recipe for every scope", () => {
    for (const [name, selector] of Object.entries(SCOPES)) {
      const recipe = recipeFor(selector);
      expect(Object.keys(recipe).sort(), name).toEqual([
        "--capability-badge-fill-base",
        "--capability-badge-fill-hue",
        "--capability-badge-ink-base",
        "--capability-badge-ink-hue",
      ]);
    }
  });
});

describe("capability badge contrast (#330)", () => {
  it.each(["dark", "light"] as const)(
    "clears AA for every capability in %s",
    (base) => {
      const recipe = recipeFor(SCOPES[base]);
      const failures: string[] = [];
      for (const [capability, hue] of Object.entries(hues())) {
        const ratio = contrastRatio(ink(hue, recipe), fill(hue, recipe));
        if (ratio === null || ratio < MIN_RATIO) {
          failures.push(`${capability} ${ratio?.toFixed(2) ?? "unparseable"}`);
        }
      }
      expect(failures).toEqual([]);
    },
  );

  it("would fail if the recipe stopped separating ink from fill", () => {
    // Guards the assertion above against passing for the wrong reason. The pre-#330
    // badge is exactly `ink-hue: 100%` over a fill that is mostly the page, so feeding
    // the old recipe through the same maths must go red — otherwise a green suite
    // proves only that the maths runs.
    const asBefore = {
      "--capability-badge-fill-base": "#ffffff",
      "--capability-badge-fill-hue": "9%",
      "--capability-badge-ink-base": "#ffffff",
      "--capability-badge-ink-hue": "100%",
    };
    const ratios = Object.values(hues()).map((hue) =>
      contrastRatio(ink(hue, asBefore), fill(hue, asBefore)),
    );
    expect(ratios.every((r) => r !== null && r < AA_TEXT_RATIO)).toBe(true);
  });

  it("keeps the two bases genuinely different recipes", () => {
    // A copy-paste that pointed both bases at the same extremes would still clear AA
    // in one of them and be unreadable in the other.
    expect(recipeFor(SCOPES.light)["--capability-badge-fill-base"]).not.toBe(
      recipeFor(SCOPES.dark)["--capability-badge-fill-base"],
    );
  });

  it("declares the dark recipe identically in the data-theme and system scopes", () => {
    // `system` is a separate media block because a media query cannot join a selector
    // list, so the dark values exist twice. The theme clear-list drifted to 16 of 25
    // keys this way (#336); an OS-dark user would get the LIGHT recipe on a dark page.
    expect(recipeFor(SCOPES.system)).toEqual(recipeFor(SCOPES.dark));
  });
});

describe("nothing may reintroduce an indeterminate pairing", () => {
  it("gives the badge no opacity", () => {
    // Element opacity composites the text against its own fill: the 0.8 the
    // description span carried pulled 6 of 13 capabilities in light and 7 of 13 in
    // dark back under AA, worst 3.20:1, on the one view that shows the prose.
    for (const selector of [
      ".plugin-capability-badge",
      ".plugin-capability-badge__description",
    ]) {
      expect(declarationsFor(selector), selector).not.toMatch(/\bopacity\s*:/u);
    }
  });

  it("mixes both sides toward an opaque base, never a page colour", () => {
    // `color-mix(hue X%, var(--color-bg-default))` would look better on Solarized's
    // cream page and would also make the ratio depend on a colour the user can edit —
    // which is the whole defect. Both mixes must land on the recipe's own extremes.
    const rule = declarationsFor(".plugin-capability-badge");
    for (const property of ["background-color", "color"]) {
      const declaration = new RegExp(`(?:^|;) ?${property}: ([^;]+)`, "u").exec(
        rule,
      );
      expect(declaration, property).not.toBeNull();
      expect(declaration?.[1], property).toContain("--capability-badge-hue");
      expect(declaration?.[1], property).toMatch(
        /var\(--capability-badge-(?:fill|ink)-base\)/u,
      );
    }
  });

  it("writes the same custom property the stylesheet reads", () => {
    // The two halves agree by convention and nothing else. Rename it on one side and
    // every badge silently falls back to the default grey: still readable, so the
    // contrast assertions stay green while the colour coding is gone. Same shape as a
    // protocol member with no runtime allowlist entry — the transport looks fine and
    // the feature ships dead.
    const written = /"(--[a-z][\w-]*)":/u.exec(TSX);
    expect(written, "no custom property set in the component").not.toBeNull();
    const rule = declarationsFor(".plugin-capability-badge");
    expect(rule).toContain(`var(${written?.[1]})`);
    expect(rule).toContain(`${written?.[1]}: `);
  });

  it("leaves no colour literal in the component outside the hue map", () => {
    // The badge is styled entirely by class now; the single inline value is the hue
    // custom property. A quoted colour anywhere else means a hardcoded pairing came
    // back, which is how the accent regressed in `PluginMarketplace` (#336).
    const withoutMap = TSX.replace(
      /const CAPABILITY_COLORS[^}]+\}/u,
      "<hue map>",
    );
    expect(withoutMap).not.toMatch(/["'`]#[0-9a-fA-F]{3,8}["'`]/u);
    expect(withoutMap).not.toMatch(/\bbackgroundColor\b/u);
  });
});

/** Declarations of the first rule whose selector is exactly `selector`. */
function declarationsFor(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`plugins.css has no rule for ${selector}`);
  const body = CSS.slice(at + selector.length + 2);
  return body.slice(0, body.indexOf("}"));
}

/** `#rgb` → `#rrggbb`. stylelint's `--fix` rewrites the recipe's bases to shorthand. */
function expand(hex: string): string {
  const body = hex.slice(1);
  return body.length === 3
    ? `#${body.replaceAll(/./gu, (c) => c + c)}`
    : `#${body}`;
}

/** The opaque fill a hue lands on under `recipe`. */
function fill(hue: string, recipe: Record<string, string>): string {
  return mix(
    hue,
    percent(recipe["--capability-badge-fill-hue"]),
    recipe["--capability-badge-fill-base"],
  );
}

/** Every capability hue, read out of the component's own map. */
function hues(): Record<string, string> {
  const block = /const CAPABILITY_COLORS[^{]+\{([^}]+)\}/u.exec(TSX);
  if (block === null) {
    throw new Error("PluginCapabilityBadge.tsx has no CAPABILITY_COLORS map");
  }
  const found: Record<string, string> = {};
  for (const [, key, hex] of block[1].matchAll(
    /"?([\w:]+)"?\s*:\s*"(#[0-9a-fA-F]{6})"/gu,
  )) {
    found[key] = hex;
  }
  return found;
}

/** The opaque text colour a hue lands on under `recipe`. */
function ink(hue: string, recipe: Record<string, string>): string {
  return mix(
    hue,
    percent(recipe["--capability-badge-ink-hue"]),
    recipe["--capability-badge-ink-base"],
  );
}

/** `color-mix(in srgb, a p%, b)` — gamma-encoded sRGB, which is what `in srgb` means. */
function mix(a: string, p: number, b: string): string {
  const [ea, eb] = [expand(a), expand(b)];
  const t = p / 100;
  const channels = [0, 2, 4].map((i) => {
    const ca = Number.parseInt(ea.slice(1 + i, 3 + i), 16);
    const cb = Number.parseInt(eb.slice(1 + i, 3 + i), 16);
    return Math.round(ca * t + cb * (1 - t));
  });
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function percent(value: string): number {
  return Number.parseFloat(value);
}

/** The four recipe custom properties declared by `selector`. */
function recipeFor(selector: string): Record<string, string> {
  const declarations = declarationsFor(selector);
  const recipe: Record<string, string> = {};
  for (const [, key, value] of declarations.matchAll(
    /(--capability-badge-(?:fill|ink)-(?:base|hue))\s*:\s*([^;]+)/gu,
  )) {
    recipe[key] = value.trim();
  }
  return recipe;
}

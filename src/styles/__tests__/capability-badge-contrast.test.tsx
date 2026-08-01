// The capability badge's derived tint pairing must clear AA for every capability, in
// both bases (#330).
//
// The badge painted a capability's hue as its own text on a 9% tint of itself. A 9%
// tint is 91% whatever is behind it, so the pairing was really hue-vs-page and failed
// AA in 74 of 96 capability x built-in-theme combinations — all twelve then existing in
// every light theme, and seven of the twelve in EVERY theme including `network`.
//
// Both sides are now opaque `color-mix()` results, so the ratio is a property of the
// hue and the base alone: no page colour, custom theme or user `--color-bg-*` edit can
// move it. This file reads the recipe out of the SHIPPED stylesheet and the hues out of
// the SHIPPED component rather than restating either, so a value edited in one place
// cannot leave the guard measuring the old one.
//
// ‼️ The arithmetic half of this guard was live from the start; the STRUCTURAL half was
// not. A review applied 22 mutations to the shipped CSS and TSX and 15 survived — most
// importantly renaming `className` to a class the stylesheet does not define, which left
// the badge completely unstyled with every test green. The assertions under "the
// stylesheet actually reaches the badge" and most of the last block exist because a
// mutation walked through the earlier version of this file untouched.
import { render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PluginCapabilityBadge } from "../../components/plugins/PluginCapabilityBadge";
import { CAPABILITY_DESCRIPTIONS } from "../../plugins/types";
import {
  AA_TEXT_RATIO,
  contrastRatio,
  relativeLuminance,
} from "../../utils/color-contrast";
import { cssRules, mediaConditionFor } from "./css-rules";

/** The class the stylesheet defines and the component must therefore carry. */
const BADGE = "plugin-capability-badge";

/** Every capability that exists, from the map whose keys are the validation allowlist. */
const CAPABILITIES = Object.keys(CAPABILITY_DESCRIPTIONS);

/**
 * Deliberately stricter than AA, and the reason is `mix()` below.
 *
 * `color-mix()` interpolates in floats and the browser composites at more than 8 bits;
 * this file models it in whole channels. The error is under 1/255, which is nothing to
 * a ratio — unless the ratio sits 0.03 above the line, which is what the loosest
 * passing percentages (57%/93%) produce. Requiring headroom means a green run here
 * cannot be an artefact of where the model rounds. The relationship to AA is asserted,
 * so this cannot be quietly lowered to meet a failing pairing.
 *
 * The binding hue is a mid-grey (`settings`, 4.995 in dark) because a grey has no
 * channel to spare in either direction. A future mid-grey capability lands here first,
 * and that reads as "this hue is constrained", not "the threshold is too tight".
 */
const MIN_RATIO = 4.75;

/** The four custom properties a recipe scope must declare — all of them, exactly. */
const RECIPE_KEYS = [
  "--capability-badge-fill-base",
  "--capability-badge-fill-hue",
  "--capability-badge-ink-base",
  "--capability-badge-ink-hue",
];

const RULES = cssRules();

/** The three scopes that set the recipe, keyed by the selector each one uses. */
const SCOPES = {
  dark: '[data-theme="dark"]',
  light: ":root",
  system: 'html:not([data-theme="light"], [data-theme="dark"])',
} as const;

const TSX = readFileSync(
  resolve(__dirname, "../../components/plugins/PluginCapabilityBadge.tsx"),
  "utf8",
);

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

  it("gives every capability but one intended pair a distinct hue", () => {
    // Coverage is not distinctness. `viewer: "#6b7280"` restores the exact defect the
    // type change was made to prevent — a capability rendering identically to
    // `settings` — and a key-coverage assertion cannot see it.
    const byHue = new Map<string, string[]>();
    for (const [capability, hue] of Object.entries(hues())) {
      byHue.set(hue, [...(byHue.get(hue) ?? []), capability]);
    }
    const shared = [...byHue.values()]
      .filter((caps) => caps.length > 1)
      .map((caps) => [...caps].sort().join("+"));
    // The one intended collision: two UI-surface capabilities that read as one family.
    expect(shared).toEqual(["sidebar+statusbar"]);
  });

  it("reads a complete recipe for every scope", () => {
    for (const [name, selector] of Object.entries(SCOPES)) {
      expect(Object.keys(recipeFor(selector)).sort(), name).toEqual(
        RECIPE_KEYS,
      );
    }
  });

  it("lets no other stylesheet declare the recipe", () => {
    // The scopes are read out of plugins.css because `:root` is declared in several
    // files. That narrowing is only safe while plugins.css is the sole author: a
    // `--capability-badge-ink-hue` set at `:root` in a file imported later would win on
    // source order and the guard would still be measuring plugins.css's value.
    const elsewhere = RULES.filter(
      (rule) =>
        !rule.file.endsWith("/plugins.css") &&
        /--capability-badge-[\w-]+\s*:/u.test(rule.body),
    ).map((rule) => `${rule.file}:${rule.line}`);
    expect(elsewhere).toEqual([]);
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

  it("puts white at the light base and black at the dark base, not merely different ones", () => {
    // Asserting only that the two bases DIFFER lets a wholesale swap through: every
    // dark theme then renders a near-white pill with dark ink on a dark page, at an
    // unchanged 5.29:1, so no contrast assertion can see it. `:root` and
    // `[data-theme="dark"]` also have identical specificity (0,1,0), so the dark block
    // wins on source order alone — reordering the file is enough to cause it.
    const extremes = {
      dark: { fill: 0, ink: 1 },
      light: { fill: 1, ink: 0 },
    } as const;
    for (const base of ["dark", "light"] as const) {
      const recipe = recipeFor(SCOPES[base]);
      expect(
        relativeLuminance(recipe["--capability-badge-fill-base"]),
        `${base} fill base`,
      ).toBe(extremes[base].fill);
      expect(
        relativeLuminance(recipe["--capability-badge-ink-base"]),
        `${base} ink base`,
      ).toBe(extremes[base].ink);
    }
  });

  it("declares the dark recipe identically in the data-theme and system scopes", () => {
    // `system` is a separate media block because a media query cannot join a selector
    // list, so the dark values exist twice. The theme clear-list drifted to 16 of 25
    // keys this way (#336); an OS-dark user would get the LIGHT recipe on a dark page.
    expect(recipeFor(SCOPES.system)).toEqual(recipeFor(SCOPES.dark));
  });

  it("keeps the system scope inside a prefers-color-scheme: dark query", () => {
    // Equality with the dark recipe says nothing about REACHABILITY. Lift this rule out
    // of its media query and it applies unconditionally: every `system` user on an
    // OS-LIGHT desktop gets a near-black pill with light text on a white page. Flip the
    // query to `light` and both halves of that population get the wrong recipe. A
    // selector lookup finds the rule either way, so the condition needs saying.
    expect(mediaConditionFor(ruleFor(SCOPES.system).file, SCOPES.system)).toBe(
      "(prefers-color-scheme: dark)",
    );
  });
});

describe("the stylesheet actually reaches the badge", () => {
  it("renders the class the stylesheet defines", () => {
    // The gap that made every other assertion in this file bypassable: they all read
    // the stylesheet and nothing read the element. Renaming `className` to a class
    // plugins.css does not define leaves the badge with no pill, no fill and no derived
    // ink — inheriting the page's text colour — while every test stays green.
    const { container } = render(<PluginCapabilityBadge capability="editor" />);
    expect(container.firstElementChild?.classList.contains(BADGE)).toBe(true);
    expect(RULES.some((rule) => rule.selector === `.${BADGE}`)).toBe(true);
  });

  it("renders the hue the stylesheet mixes from", () => {
    const { container } = render(
      <PluginCapabilityBadge capability="network" />,
    );
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.style.getPropertyValue("--capability-badge-hue")).toBe(
      hues().network,
    );
  });

  it("gives the description the class its size rule targets", () => {
    // The size step is the ONLY hierarchy cue left now that `opacity: 0.8` is gone, so
    // a class matching no rule silently flattens the two halves into one run.
    const { container } = render(
      <PluginCapabilityBadge capability="editor" showDescription />,
    );
    expect(container.querySelector(`.${BADGE}__description`)).not.toBeNull();
    expect(
      RULES.some((rule) => rule.selector === `.${BADGE}__description`),
    ).toBe(true);
  });
});

describe("nothing may reintroduce an indeterminate pairing", () => {
  it("declares no opacity on any rule targeting the badge", () => {
    // Scoping this to two exact selectors false-passed on
    // `.plugin-capability-badge:hover { opacity: .6 }`, on a second
    // `.plugin-capability-badge { opacity: .55 }` rule appended later, and on
    // `.plugin-capability-badge, .plugin-card { opacity: .8 }` — each of which
    // re-creates the defect. Every rule in src/styles whose selector LIST touches the
    // class is in scope now, states and descendants included.
    const offenders = badgeRules()
      .filter((rule) => /\bopacity\s*:/u.test(rule.body))
      .map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("mixes ink and fill from exactly the hue and their own recipe bases", () => {
    // Checking only that two expected names APPEAR let a one-character typo through:
    // `var(--capability-badge-ink-hu)` is unresolvable, which invalidates the whole
    // declaration at computed-value time — `color` becomes `unset` and inherits the
    // page, or `background-color` falls back to `transparent` and the pairing is
    // page-dependent again. Asserting the exact SET catches a typo and a page colour
    // with one rule.
    const body = ruleFor(`.${BADGE}`).body;
    for (const side of ["fill", "ink"] as const) {
      const property = side === "fill" ? "background-color" : "color";
      const value = declarationIn(body, property);
      expect(value, property).not.toBeNull();
      const referenced = [...(value ?? "").matchAll(/var\((--[\w-]+)\)/gu)]
        .map((match) => match[1])
        .sort();
      expect(referenced, property).toEqual(
        [
          "--capability-badge-hue",
          `--capability-badge-${side}-base`,
          `--capability-badge-${side}-hue`,
        ].sort(),
      );
    }
  });

  it("keeps every declaration the inline style used to carry", () => {
    // The commit deleted a React style object, which the compiler guaranteed, and
    // replaced it with a class, which nothing guarantees. Each of these could be
    // deleted with the suite still green: without padding and border-radius the pill is
    // a bare span; without the flex trio the label and description collapse together.
    const body = ruleFor(`.${BADGE}`).body;
    for (const property of [
      "align-items",
      "background-color",
      "border",
      "border-radius",
      "color",
      "display",
      "font-size",
      "font-weight",
      "gap",
      "line-height",
      "padding",
    ]) {
      expect(declarationIn(body, property), property).not.toBeNull();
    }
    expect(
      declarationIn(ruleFor(`.${BADGE}__description`).body, "font-size"),
    ).not.toBeNull();
  });

  it("defaults the hue to the settings grey it claims to", () => {
    expect(recipeFor(`.${BADGE}`)["--capability-badge-hue"]).toBe(
      hues().settings,
    );
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

/** Rules anywhere in `src/styles` whose selector list touches the badge class. */
function badgeRules() {
  const target = new RegExp(`\\.${BADGE}(?![\\w-])`, "u");
  return RULES.filter((rule) =>
    rule.selector.split(",").some((one) => target.test(one)),
  );
}

/** One declaration's value from a rule body, or null when the property is absent. */
function declarationIn(body: string, property: string): null | string {
  const found = new RegExp(`(?:^|;)\\s*${property}\\s*:([^;]+)`, "u").exec(
    body,
  );
  return found === null ? null : found[1].trim();
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

/** The numeric part of a `52%`-style recipe value. */
function percent(value: string): number {
  return Number.parseFloat(value);
}

/** Every `--capability-badge-*` custom property declared by `selector`. */
function recipeFor(selector: string): Record<string, string> {
  const recipe: Record<string, string> = {};
  const rule = selector.startsWith(".")
    ? ruleFor(selector)
    : scopeRule(selector);
  for (const [, key, value] of rule.body.matchAll(
    /(--capability-badge-[\w-]+)\s*:\s*([^;]+)/gu,
  )) {
    recipe[key] = value.trim();
  }
  return recipe;
}

/**
 * The one rule whose selector is EXACTLY `selector`, anywhere in `src/styles`.
 *
 * Exact, not "ends with": an `indexOf(selector + " {")` lookup was hijacked by an
 * unrelated `.settings-panel .plugin-capability-badge` rule earlier in the file.
 * Throwing on a duplicate matters too — a second rule for the same selector is how an
 * appended override slipped past the opacity check.
 */
function ruleFor(selector: string) {
  const found = RULES.filter((rule) => rule.selector === selector);
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one rule for ${selector}, found ${found.length}`,
    );
  }
  return found[0];
}

/**
 * A recipe scope, looked up inside plugins.css only.
 *
 * `:root` is declared in several stylesheets, so the global lookup cannot be used here.
 * Narrowing the search would let another file shadow the recipe unseen, which is why
 * "no other stylesheet declares these variables" is asserted separately rather than
 * assumed.
 */
function scopeRule(selector: string) {
  const found = RULES.filter(
    (rule) => rule.selector === selector && rule.file.endsWith("/plugins.css"),
  );
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one ${selector} rule in plugins.css, found ${found.length}`,
    );
  }
  return found[0];
}

// §5.1 — the editor's list geometry must be DERIVED, and its colours must be colours
// every theme actually sets.
//
// Both halves guard defects that were live in the styling this replaces:
//
//   * Hand-tuned constants. The fold arrow's height was `1.95em` "tuned in WebKit
//     against the real editor font", and the task checkbox was `14px`. But
//     `use-settings-effects.ts` writes BOTH `fontSize` and `lineHeight` from user
//     settings, so those two numbers are right at exactly one setting each: raise the
//     editor font to 22px and the checkbox stays 14px; set line height to 2.0 and the
//     arrow no longer sits on the marker it points at.
//
//   * Theme-blind tokens. A completed task's text used `--color-text-muted`, which is
//     NOT in `THEME_COLOR_KEYS` — so it keeps its default value under Nord, Solarized
//     and Tokyo Night instead of following the theme. This is the same shape as the
//     §30 graph-colour bug: a token that resolves to *something* everywhere, so
//     nothing looks broken until you switch themes.
//
// Asserted over the whole stylesheet rather than site by site, so the next list rule
// someone adds inherits the constraint instead of re-opening the hole.
import { describe, expect, it } from "vitest";

import { THEME_COLOR_KEYS } from "../../types/theme";
import { DERIVED_KEYS } from "../../utils/theme-vars";
import {
  cssDeclarations,
  cssRules,
  selectorParts,
  selectorTarget,
} from "./css-rules";

const RULES = cssRules();

/** Properties whose value is a length the editor's font settings should scale. */
const SCALED =
  /^(?:width|height|top|right|bottom|left|inset|gap|font-size|(?:margin|padding|border)(?:-(?:top|right|bottom|left|width))?)$/;

/**
 * Rules that style the editor's lists.
 *
 * `.fold-arrow` is included without a `.tiptap` scope on purpose: `fold.ts` emits that
 * widget for list items ONLY — headings fold through a `::before` pseudo-element and a
 * `fold-collapsed` node class instead (see the comment at `buildDecorations`). So every
 * `.fold-arrow` rule is a list rule, including the base one whose selector never
 * mentions a list.
 */
const LIST_RULES = RULES.filter((rule) =>
  selectorParts(rule.selector).some(
    (part) =>
      part.includes(".fold-arrow") ||
      (part.includes(".tiptap") &&
        /\b(?:ul|ol|li)\b|taskList|taskItem/u.test(part)),
  ),
);

/** Does this selector style a list CONTAINER (a `<ul>`/`<ol>`), rather than an item? */
function targetsListContainer(part: string): boolean {
  return /^(?:ul|ol)\b/u.test(selectorTarget(part));
}

function where(rule: { file: string; line: number; selector: string }): string {
  return `${rule.file}:${rule.line} ${rule.selector}`;
}

describe("editor list styling", () => {
  it("scanned the list rules", () => {
    // A floor on the sweep, not on the finding: if the selector predicate broke, every
    // assertion below would pass over an empty list.
    expect(RULES.length).toBeGreaterThan(1000);
    expect(LIST_RULES.length).toBeGreaterThanOrEqual(15);
  });
});

describe("nested list rhythm", () => {
  const nested = LIST_RULES.filter((rule) =>
    selectorParts(rule.selector).some(
      (part) => /\bli\b/u.test(part) && targetsListContainer(part),
    ),
  );

  it("zeroes the outer margin of a nested list", () => {
    // The dominant reason nested lists read as detached: `.tiptap ul, .tiptap ol` set
    // `margin: 0.5em 0`, which applies to nested lists too. Sibling items sit 0.15em
    // apart, so a parent was more than three times farther from its own children than
    // from its neighbours — exactly backwards.
    const zeroing = nested.filter((rule) =>
      cssDeclarations(rule.body).some(
        (declaration) =>
          declaration.prop === "margin" && /^0\b/u.test(declaration.value),
      ),
    );
    expect(zeroing.map(where).length).toBeGreaterThan(0);
  });

  it("never gives a nested-list selector a non-zero margin", () => {
    // Scoped to selectors that NAME a nested list, which is narrower than it first looks
    // like it should be — and deliberately so. The unscoped `.tiptap ul, .tiptap ol`
    // margin is correct and stays: a list inside a callout, a blockquote or a table cell
    // wants the same separation a paragraph gets there, and the alternative — enumerating
    // the containers that deserve a margin — makes the next container someone adds
    // default to none. So the default is a margin, the exception is being inside a list
    // item, and the exception wins on specificity (`.tiptap li ul` adds an element to
    // `.tiptap ul`). What that leaves worth guarding is a MORE specific nested rule
    // handing the margin back.
    const offenders = nested
      .filter((rule) =>
        cssDeclarations(rule.body).some(
          (declaration) =>
            /^margin(?:-top|-bottom)?$/u.test(declaration.prop) &&
            !/^0(?:\s|$)/u.test(declaration.value),
        ),
      )
      .map(where);
    expect(offenders).toEqual([]);
  });

  it("separates a top-level list from surrounding prose", () => {
    // The positive half: the nested gap collapsing to zero is only an improvement if the
    // top level still breathes. Written as a direct child of `.tiptap` so it cannot be
    // the rule the test above has to worry about.
    const topLevel = LIST_RULES.filter((rule) =>
      selectorParts(rule.selector).some(
        (part) =>
          /\.tiptap\s*>\s*(?:ul|ol)\b/u.test(part) &&
          cssDeclarations(rule.body).some(
            (declaration) =>
              declaration.prop === "margin" &&
              !/^0(?:\s|$)/u.test(declaration.value),
          ),
      ),
    );
    expect(topLevel.map(where).length).toBeGreaterThan(0);
  });
});

describe("list marker rendering", () => {
  it("keeps markers off the native ::marker", () => {
    // Not a new constraint — a regression guard for one already paid for. Under
    // `.editor-area-scroll`'s CSS `zoom`, WKWebView paints the text caret ~1 character
    // into a list item whenever a native `::marker` is present. Markers are `::before`
    // pseudo-elements for that reason, and `list-style: none` is what suppresses the
    // native one.
    const suppressing = LIST_RULES.filter((rule) =>
      cssDeclarations(rule.body).some(
        (declaration) =>
          declaration.prop === "list-style" && declaration.value === "none",
      ),
    );
    expect(suppressing.length).toBeGreaterThan(0);

    const revived = RULES.filter((rule) =>
      selectorParts(rule.selector).some(
        (part) => part.includes(".tiptap") && part.includes("::marker"),
      ),
    ).map(where);
    expect(revived).toEqual([]);
  });

  it("steps the ordered-list counter style once per depth", () => {
    // Every depth used `counter(list-item)`, so nested ordered lists read `1. 1. 1.`
    // with nothing but indentation to tell the levels apart.
    //
    // Counted, not merely found: asserting that each style "appears somewhere" would
    // stay green if a fourth depth re-used `lower-alpha`, which is the mistake this
    // cascade invites.
    const styles = LIST_RULES.flatMap((rule) =>
      [
        ...rule.body.matchAll(
          /counter\(\s*list-item\s*(?:,\s*([\w-]+))?\s*\)/gu,
        ),
      ].map((match) => match[1] ?? "decimal"),
    );
    expect([...styles].sort()).toEqual([
      "decimal",
      "lower-alpha",
      "lower-roman",
    ]);
  });
});

describe("list geometry", () => {
  it("sizes every length in font-relative units", () => {
    // `px` here means "ignores the user's font size". This carried a `1px` exemption for
    // the indent guide while the guide was a hairline; the guide is now `0.125em`, so the
    // exemption was covering nothing and is gone. `outline` is deliberately outside
    // SCALED — a focus ring is device chrome and should not grow with the prose.
    //
    // Custom properties are checked too, and that is not belt-and-braces: this file's
    // lengths all reach their consumers THROUGH one (`--guide-width`, `--marker-size`,
    // `--checkbox-size`, `--list-gutter`). A name-list of standard properties is an
    // enumeration over an unbounded space — `--guide-width: 1px` survived this mutation
    // until custom properties were added, because no standard property name matched.
    const offenders = LIST_RULES.flatMap((rule) =>
      cssDeclarations(rule.body)
        .filter(
          (declaration) =>
            (SCALED.test(declaration.prop) ||
              declaration.prop.startsWith("--")) &&
            /(?<![\w.])\d*\.?\d+px/u.test(declaration.value),
        )
        .map(
          (declaration) =>
            `${where(rule)} { ${declaration.prop}: ${declaration.value} }`,
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("measures the ordered gutter in ch, and steps it in source order", () => {
    // Two separate ways this rule set breaks silently.
    //
    // ONE — a digit width written in `em` is a guess about a font this app does not ship.
    // `--font-family-editor` names Pretendard and Inter but there is no @font-face and no
    // bundled file, so on a machine with neither it renders in `-apple-system`. `ch` is the
    // font's own "0" advance, so the gutter is correct on every machine instead of on the
    // author's. Any ordered gutter that widens for digits must therefore use `ch`.
    //
    // Scoped to the rules that WIDEN for digits. The base `.tiptap ul, .tiptap ol` floor is
    // a plain `1.4em` and correctly so — it is the bullet-list indent, not a digit
    // measurement — so a predicate of "mentions ol and sets --list-gutter" reports it as a
    // guess and the test fails on correct code.
    const orderedGutters = LIST_RULES.filter(
      (rule) =>
        /\bol\b/u.test(rule.selector) &&
        /nth-child|\[start\]/u.test(rule.selector) &&
        cssDeclarations(rule.body).some((d) => d.prop === "--list-gutter"),
    );
    expect(orderedGutters.length).toBeGreaterThanOrEqual(2);
    const guessed = orderedGutters
      .filter(
        (rule) =>
          !(
            cssDeclarations(rule.body).find((d) => d.prop === "--list-gutter")
              ?.value ?? ""
          ).includes("ch"),
      )
      .map(where);
    expect(guessed).toEqual([]);

    // TWO — `:has(> li:nth-child(10))` and `:has(> li:nth-child(100))` have IDENTICAL
    // specificity, so only source order decides which wins for a list of 100+ items. Swap
    // them and three-digit lists quietly get the two-digit gutter; nothing else changes,
    // and no other assertion here would notice.
    const at = (n: number) =>
      orderedGutters.find((rule) => rule.selector.includes(`nth-child(${n})`));
    const two = at(10);
    const three = at(100);
    expect(two).toBeDefined();
    expect(three).toBeDefined();
    // `index` is a character offset within one file, so comparing across files would be
    // meaningless. Assert they share one before ordering them.
    expect(three?.file).toBe(two?.file);
    expect(three?.index).toBeGreaterThan(two?.index as number);
  });

  it("hangs the indent guide in the parent's marker gutter", () => {
    // The structural half of "the rail descends from the parent's bullet": whatever the
    // tuned offset is, it has to be NEGATIVE — a guide at `left: 0` sits at the parent's
    // text column, which is where this started and what the reference design rejected.
    // The exact -1em is left free to tune; the side of the list it falls on is not.
    // The guide is a `::before` on the nested LIST. Matching `li::before` instead picks up
    // the marker rules, which are anchored with `right: 100%` and have no `left` at all —
    // a first version of this test reported them as guides on the wrong side.
    const guides = LIST_RULES.filter((rule) =>
      selectorParts(rule.selector).some(
        (part) =>
          /\bli\b/u.test(part) &&
          /^(?:ul|ol)::before$/u.test(selectorTarget(part)),
      ),
    );
    const offsets = guides.map((rule) => ({
      left: cssDeclarations(rule.body).find((d) => d.prop === "left")?.value,
      rule,
    }));
    expect(offsets.length).toBeGreaterThan(0);
    const wrongSide = offsets
      .filter(({ left }) => left === undefined || !left.startsWith("-"))
      .map(({ rule }) => where(rule));
    expect(wrongSide).toEqual([]);
  });

  it("derives every vertical placement from the line height setting", () => {
    // `lineHeight` is a user setting applied inline to `.tiptap`, so anything absolutely
    // positioned onto a line box has to read it rather than assume 1.75.
    //
    // Named, not counted. A `length >= 2` version of this passed with any ONE of the
    // three sites reverted to a constant, which is exactly the regression it exists to
    // catch — and the three have to agree with each other, not merely exist: the arrow
    // points at the marker, and the checkbox shares the marker's column.
    const CENTRED_ON_A_LINE_BOX = [
      ".tiptap ul > li::before", // drawn bullet
      "> .task-checkbox", // task checkbox (a <button> since §18.18 M4)
      ".tiptap li > .fold-arrow", // fold arrow
    ];
    const missing = CENTRED_ON_A_LINE_BOX.filter(
      (selector) =>
        !LIST_RULES.some(
          (rule) =>
            rule.selector.includes(selector) &&
            rule.body.includes("--editor-line-height"),
        ),
    );
    expect(missing).toEqual([]);
  });
});

describe("list colours", () => {
  // The only colours that follow a theme are the ones a theme sets, plus the ones
  // `theme-vars.ts` derives from those. Anything else is frozen at its stylesheet
  // value the moment the user leaves the default themes.
  const THEME_SAFE = new Set<string>([
    ...THEME_COLOR_KEYS.map(({ key }) => key),
    ...DERIVED_KEYS,
  ]);

  it("knows what the themes actually override", () => {
    // Guards the guard: an empty or truncated set would make the check below vacuous.
    expect(THEME_SAFE.size).toBeGreaterThanOrEqual(30);
    expect(THEME_SAFE.has("--color-editor-text")).toBe(true);
    expect(THEME_SAFE.has("--color-text-muted")).toBe(false);
  });

  it("names only tokens every theme overrides", () => {
    const offenders = LIST_RULES.flatMap((rule) =>
      cssDeclarations(rule.body)
        .filter((declaration) =>
          /(?:^|-)(?:color|background)$/u.test(declaration.prop),
        )
        .flatMap((declaration) =>
          [...declaration.value.matchAll(/var\(\s*(--color-[\w-]+)/gu)]
            .map((match) => match[1])
            .filter((token) => !THEME_SAFE.has(token))
            .map((token) => `${where(rule)} { ${declaration.prop}: ${token} }`),
        ),
    );
    expect(offenders).toEqual([]);
  });
});

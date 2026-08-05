// §54 / #330 — a solid accent or status surface may not name its own foreground.
//
// The bug this prevents was written 80 times for the accent and 13 more for the
// status families: `background: var(--color-accent-*)` or `var(--color-status-*)`
// beside `color: white`. Any single one of those is invisible in review, and
// `npm run audit:css-vars` cannot see it — it only reports *undefined* variables.
// So the rule is asserted over the whole stylesheet rather than site by site: the
// next filled button inherits the fix instead of re-introducing the bug.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cssRules, innermostObjects, objectProperty, walk } from "./css-rules";

const SRC = "src";

/** Solid accent fill — `color-mix(...)` tints are excluded on purpose. */
const SOLID_ACCENT_BG =
  /background(?:-color)?\s*:\s*var\(\s*--color-accent-(default|hover|solid|solid-hover)\b/;
const HARDCODED_LIGHT_FG =
  /(?<!-)\bcolor\s*:\s*(white|#fff|#ffffff)\s*(?:;|$)/i;
const ON_SOLID_FG = /(?<!-)\bcolor\s*:\s*var\(\s*--color-accent-on-solid\s*\)/;

const RULES = cssRules();
const ACCENT_FILLED = RULES.filter((rule) => SOLID_ACCENT_BG.test(rule.body));

describe("solid accent surfaces in CSS", () => {
  it("scanned enough of the stylesheet to be meaningful", () => {
    // Without this, a broken regex would make every assertion below vacuous.
    expect(RULES.length).toBeGreaterThan(1000);
    expect(ACCENT_FILLED.length).toBeGreaterThanOrEqual(80);
  });

  it("never hardcodes a light foreground", () => {
    const offenders = ACCENT_FILLED.filter((rule) =>
      HARDCODED_LIGHT_FG.test(rule.body),
    ).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("uses accent-on-solid wherever a filled accent surface sets a colour", () => {
    // A filled accent surface that names any other foreground is either a bug or
    // a colour that has not been checked against every theme's accent.
    const offenders = ACCENT_FILLED.filter(
      (rule) =>
        /(?<!-)\bcolor\s*:/.test(rule.body) && !ON_SOLID_FG.test(rule.body),
    ).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("keeps accent-default for surfaces that carry no text", () => {
    // Dots, drop indicators and resize handles want the bright accent, not the
    // text-bearing fill — they have no foreground to contrast with.
    //
    // Named rather than counted. An earlier version asserted only `length > 0`,
    // which would have stayed green with 15 of the 16 wrongly converted — it
    // proved the category was non-empty, not that these surfaces survived.
    const stillBright = new Set(
      RULES.filter((rule) =>
        /background(?:-color)?\s*:\s*var\(\s*--color-accent-default\b/.test(
          rule.body,
        ),
      ).map((rule) => rule.selector),
    );
    const expected = [
      '.contribution-heatmap-cell[data-level="4"]',
      ".activity-bar-btn-active::before",
      ".calendar-dot-filled",
      ".drop-indicator-bar",
      ".drop-indicator-bar::before",
      ".graph-settings-toggle.on",
      ".media-resize-handle::before",
      ".plugin-consent__cap::before",
      ".settings-toggle-on",
      ".splitter:hover",
      ".status-git-dot",
      ".tab-drop-indicator-end",
      ".table-drop-indicator",
      ".table-grid-cell-active",
      ".tiptap .column-resize-handle",
      ".update-dialog-progress-fill",
    ];
    expect(expected.filter((selector) => !stillBright.has(selector))).toEqual(
      [],
    );
  });
});

describe("solid status surfaces in CSS", () => {
  // Same defect, different token family, and worse: white on `--color-status-warning`
  // measures 2.15:1 and on `--color-status-success` 2.54:1 — under even the 3:1
  // non-text floor, and unlike the accent these values do not vary by theme, so
  // every user saw them.
  const STATUS_FILL =
    /background(?:-color)?\s*:\s*var\(\s*--color-status-(danger|warning|success)\b/;
  const statusFilled = RULES.filter((rule) => STATUS_FILL.test(rule.body));

  it("scanned the status-filled rules", () => {
    expect(statusFilled.length).toBeGreaterThanOrEqual(10);
  });

  it("never hardcodes a light foreground", () => {
    const offenders = statusFilled
      .filter((rule) => HARDCODED_LIGHT_FG.test(rule.body))
      .map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("names the matching on-solid token when it sets a foreground", () => {
    // A filled danger surface must use the danger foreground, not the warning one:
    // the families are user-editable independently, so a mismatched pair is a
    // pairing nothing has checked.
    const offenders = statusFilled
      .filter((rule) => /(?<!-)\bcolor\s*:/.test(rule.body))
      .filter((rule) => {
        // Last declaration wins in CSS, so the effective fill is the last match.
        const family = [
          ...rule.body.matchAll(new RegExp(STATUS_FILL.source, "g")),
        ].at(-1)?.[1];
        return !new RegExp(
          `(?<!-)\\bcolor\\s*:\\s*var\\(\\s*--color-status-${family}-on-solid\\s*(?:,[^)]*)?\\)`,
        ).test(rule.body);
      })
      .map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });
});

describe("hardcoded light foregrounds anywhere in CSS", () => {
  // Rule-scoped checks cannot see the shape that `.skill-lint-badge` had: `color:
  // white` on a base class while the fills lived on its modifiers. That defect was
  // found by reading components, not by a guard. Inverting the question closes it —
  // a hardcoded light foreground is flagged wherever it appears, and the handful of
  // legitimate ones are named.
  const ALLOWED = new Set([
    // White on the photo lightbox's own dark scrim (rgb(0 0 0 / 60-92%)), not on a
    // theme colour, so no token applies.
    ".photo-gallery-item-caption",
    ".photo-lightbox-caption",
    ".photo-lightbox-close",
    ".photo-lightbox-nav",
    ".photo-lightbox-open-journal",
  ]);

  it("has none outside the named exceptions", () => {
    const offenders = RULES.filter(
      (rule) =>
        HARDCODED_LIGHT_FG.test(rule.body) && !ALLOWED.has(rule.selector),
    ).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("still finds the named exceptions, so the check is not vacuous", () => {
    const found = RULES.filter(
      (rule) =>
        HARDCODED_LIGHT_FG.test(rule.body) && ALLOWED.has(rule.selector),
    );
    expect(found.length).toBe(ALLOWED.size);
  });
});

describe("hover fills on a solid surface", () => {
  it("are never a color-mix toward a hardcoded black or white", () => {
    // The direction has to come from whichever foreground the fill took. Mixing
    // toward black broke the themes whose danger takes dark text (4.21:1); mixing
    // toward white then broke Solarized, whose #dc322f takes white (3.83:1). A
    // constant cannot serve both, so a derived *-solid-hover token must be used.
    const offenders = RULES.filter((rule) =>
      /background(?:-color)?\s*:\s*color-mix\([^;]*var\(\s*--color-(?:accent|status)-[\w-]+\s*\)[^;]*,\s*(?:black|white|#000|#fff)/.test(
        rule.body,
      ),
    ).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });
});

describe("solid accent surfaces in inline styles", () => {
  // This scan was originally rooted at `src/components` and matched only JSX
  // `style={{…}}` literals. Both narrowings hid a live defect: PluginMarketplace
  // keeps its styles in a module-level `STYLES` constant and has zero JSX style
  // literals, so an `accent-default` + `#fff` retry button sat in the sweep's own
  // directory, unseen, while this file reported green. It now walks all of `src`
  // and reads brace-matched objects, whatever syntax holds them.
  const objects = walk(SRC, ".tsx")
    .concat(walk(SRC, ".ts"))
    .filter((file) => !file.includes("__tests__"))
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return innermostObjects(source)
        .filter((object) =>
          /(?<![-\w])(background(?:Color)?|color)\s*:/.test(object.body),
        )
        .map((object) => ({
          body: object.body,
          file,
          line: source.slice(0, object.start).split("\n").length,
        }));
    });

  // Bound to the one property, not to the object. Scanning the whole object body
  // for an accent token flagged `backgroundColor: "transparent"` objects whose
  // *border* used the accent, and accent `color-mix()` tints whose text is meant to
  // be accent-coloured — neither is a filled surface.
  const accentObjects = objects.filter((object) => {
    const fill = objectProperty(object.body, /^background(Color)?$/);
    return (
      fill !== null &&
      fill.includes("--color-accent-") &&
      !fill.includes("color-mix")
    );
  });

  it("parsed style objects across the tree", () => {
    // A floor on the parse, not on the finding: if brace matching collapsed, every
    // assertion below would pass over an empty list. Deliberately not pinned to the
    // number of accent objects — that number is what a new defect would change.
    expect(objects.length).toBeGreaterThan(50);
    expect(accentObjects.length).toBeGreaterThan(0);
  });

  it("fills from accent-solid, never from accent-default or accent-hover", () => {
    const offenders = accentObjects
      .filter((object) =>
        /--color-accent-(default|hover)\b/.test(
          objectProperty(object.body, /^background(Color)?$/) ?? "",
        ),
      )
      .map((object) => `${object.file}:${object.line}`);
    expect(offenders).toEqual([]);
  });

  const statusObjects = objects.filter((object) => {
    const fill = objectProperty(object.body, /^background(Color)?$/);
    return fill !== null && fill.includes("--color-status-");
  });

  it("found the inline status buttons", () => {
    // Added because the accent-only version of this scan left the three TSX status
    // buttons this commit converted entirely unguarded.
    expect(statusObjects.length).toBeGreaterThan(0);
  });

  it("never hardcodes a light foreground on a status fill", () => {
    const offenders = statusObjects
      .filter((object) =>
        /^\s*"(#fff|#ffffff|white)"\s*$/i.test(
          objectProperty(object.body, /^color$/) ?? "",
        ),
      )
      .map((object) => `${object.file}:${object.line}`);
    expect(offenders).toEqual([]);
  });

  it("never hardcodes a light foreground in a style object", () => {
    const offenders = accentObjects
      .filter((object) =>
        /^\s*"(#fff|#ffffff|white)"\s*$/i.test(
          objectProperty(object.body, /^color$/) ?? "",
        ),
      )
      .map((object) => `${object.file}:${object.line}`);
    expect(offenders).toEqual([]);
  });
});

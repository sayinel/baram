// §54 / #330 — a solid accent surface may not name its own foreground.
//
// The bug this prevents was written 80 times: `background: var(--color-accent-*)`
// beside `color: white`. Any single one of those is invisible in review, and
// `npm run audit:css-vars` cannot see it — it only reports *undefined* variables.
// So the rule is asserted over the whole stylesheet rather than site by site: the
// next accent button inherits the fix instead of re-introducing the bug.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const STYLES = "src/styles";
const COMPONENTS = "src/components";

/** Solid accent fill — `color-mix(...)` tints are excluded on purpose. */
const SOLID_ACCENT_BG =
  /background(?:-color)?\s*:\s*var\(\s*--color-accent-(default|hover|solid|solid-hover)\b/;
const HARDCODED_LIGHT_FG =
  /(?<!-)\bcolor\s*:\s*(white|#fff|#ffffff)\s*(?:;|$)/i;
const ON_SOLID_FG = /(?<!-)\bcolor\s*:\s*var\(\s*--color-accent-on-solid\s*\)/;

interface Rule {
  body: string;
  file: string;
  line: number;
  selector: string;
}

/** Every CSS rule outside `generated/`, which Style Dictionary owns. */
function cssRules(): Rule[] {
  const rules: Rule[] = [];
  for (const file of walk(STYLES, ".css")) {
    if (file.includes("/generated/")) continue;
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      rules.push({
        body: match[2],
        file,
        line: css.slice(0, match.index).split("\n").length,
        selector: match[1].trim().replace(/\s+/g, " "),
      });
    }
  }
  return rules;
}

function walk(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(path, ext);
    return entry.name.endsWith(ext) ? [path] : [];
  });
}

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
    const nonText = RULES.filter(
      (rule) =>
        /background(?:-color)?\s*:\s*var\(\s*--color-accent-default\b/.test(
          rule.body,
        ) && !/(?<!-)\bcolor\s*:/.test(rule.body),
    );
    expect(nonText.length).toBeGreaterThan(0);
  });
});

describe("solid accent surfaces in inline styles", () => {
  const inline = walk(COMPONENTS, ".tsx")
    .filter((file) => !file.includes("__tests__"))
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/style=\{\{(.*?)\}\}/gs)].map((match) => ({
        body: match[1],
        file,
        line: source.slice(0, match.index).split("\n").length,
      }));
    })
    // A ternary splits the value across lines, so `.` must cross newlines here.
    .filter((entry) =>
      /background(?:Color)?:\s*(?:[^,]|\n)*?--color-accent-(default|hover|solid)/.test(
        entry.body,
      ),
    );

  it("found the inline accent buttons", () => {
    expect(inline.length).toBeGreaterThanOrEqual(3);
  });

  it("never hardcodes a light foreground in a style object", () => {
    const offenders = inline
      .filter((entry) =>
        /\bcolor:\s*(?:[^,]|\n)*?"(#fff|#ffffff|white)"/i.test(entry.body),
      )
      .map((entry) => `${entry.file}:${entry.line}`);
    expect(offenders).toEqual([]);
  });
});

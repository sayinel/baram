// Shared stylesheet reader for the CSS guards in this directory.
//
// Extracted from solid-fill-pairing.test.ts when a second guard grew its own parser
// and got it wrong three ways: an `indexOf(selector + " {")` over comment-unstripped
// text false-PASSED on `.plugin-capability-badge:hover { opacity: .6 }` (a rule the
// guard existed to forbid), and false-FAILED both on a comment mentioning the
// forbidden property inside a rule body — which this repo does routinely — and on an
// unrelated `.settings-panel .plugin-capability-badge` rule appearing earlier in the
// file, which hijacked the lookup.
//
// One parser, so a guard asks "which rules target this?" rather than "where does this
// string appear?". Comments are stripped and every stylesheet is walked, which is why
// a property forbidden on a selector is forbidden on its states and its descendants
// too, in whatever file someone writes them.
import { readdirSync, readFileSync } from "node:fs";

export interface Rule {
  body: string;
  file: string;
  line: number;
  selector: string;
}

/**
 * Every CSS rule outside `generated/`, which Style Dictionary owns.
 *
 * Nested at-rules yield their INNER rule: the outer `@media (...)` cannot be captured
 * by a body pattern that excludes braces, so a rule inside a media query appears with
 * its own selector and the condition dropped. A guard that depends on the condition
 * has to assert that separately — {@link mediaConditionFor} is for exactly that.
 */
export function cssRules(): Rule[] {
  const rules: Rule[] = [];
  for (const file of walk(STYLES, ".css")) {
    if (file.includes("/generated/")) continue;
    const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      rules.push({
        body: match[2],
        file,
        line: css.slice(0, match.index).split("\n").length,
        selector: match[1].trim().replaceAll(/\s+/gu, " "),
      });
    }
  }
  return rules;
}

/**
 * The `@media` condition a rule is nested in, or null when it is at top level.
 *
 * {@link cssRules} drops it, and for a rule that only makes sense inside a media query
 * that omission is load-bearing: a system-theme scope lifted out of its
 * `prefers-color-scheme` wrapper would still be found by selector and would then apply
 * unconditionally, which is the opposite of what it is for.
 */
export function mediaConditionFor(
  file: string,
  selector: string,
): null | string {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
  const at = css.indexOf(selector);
  if (at === -1) return null;
  // Walk back counting braces: an unmatched `{` means an enclosing block, and the
  // text before it is its at-rule prelude.
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (css[i] === "}") depth++;
    else if (css[i] === "{") {
      if (depth === 0) {
        const prelude = css.slice(0, i).match(/@media([^{};]*)$/u);
        return prelude === null ? null : prelude[1].trim();
      }
      depth--;
    }
  }
  return null;
}

/** Files under `dir` with extension `ext`, recursively. */
export function walk(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(path, ext);
    return entry.name.endsWith(ext) ? [path] : [];
  });
}

const STYLES = "src/styles";

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
  /** Character offset of the rule's selector, so a caller never re-finds it by text. */
  index: number;
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
        index: match.index,
        line: css.slice(0, match.index).split("\n").length,
        selector: match[1].trim().replaceAll(/\s+/gu, " "),
      });
    }
  }
  return rules;
}

/**
 * Brace-matched objects containing no nested object — where style properties live,
 * whether the object sits in a JSX `style={{…}}` literal, a module-level constant, or
 * anything else. Matching on syntax rather than on one calling convention is the point:
 * the CSS guards here reason about stylesheets, and the defect they guard against was
 * originally written as an inline style object.
 */
export function innermostObjects(
  source: string,
): { body: string; start: number }[] {
  const found: { body: string; start: number }[] = [];
  const opens: number[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") opens.push(i);
    else if (source[i] === "}") {
      const start = opens.pop();
      if (start === undefined) continue;
      const body = source.slice(start + 1, i);
      if (!body.includes("{")) found.push({ body, start });
    }
  }
  return found;
}

/**
 * The `@media` condition a rule is nested in, or null when it is at top level.
 *
 * {@link cssRules} drops it, and for a rule that only makes sense inside a media query
 * that omission is load-bearing: a system-theme scope lifted out of its
 * `prefers-color-scheme` wrapper would still be found by selector and would then apply
 * unconditionally, which is the opposite of what it is for.
 */
export function mediaConditionFor(rule: Rule): null | string {
  const css = readFileSync(rule.file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");
  // `rule.index`, not `indexOf(rule.selector)`: re-finding a rule by its text lands on
  // the FIRST occurrence in the file, which is a different rule the moment a selector
  // repeats — and then the condition reported belongs to something else.
  // Walk back counting braces: an unmatched `{` means an enclosing block, and the
  // text before it is its at-rule prelude.
  let depth = 0;
  for (let i = rule.index - 1; i >= 0; i--) {
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

/**
 * One style property's value, split at commas outside parentheses so a
 * `color-mix(in srgb, …)` value stays whole. Null when the property is absent.
 */
export function objectProperty(body: string, key: RegExp): null | string {
  let depth = 0;
  let current = "";
  const properties: string[] = [];
  for (const char of body) {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) {
      properties.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  properties.push(current);
  for (const property of properties) {
    const split = property.indexOf(":");
    if (split === -1) continue;
    if (key.test(property.slice(0, split).trim())) {
      return property.slice(split + 1);
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

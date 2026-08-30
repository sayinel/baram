// Shared scanner for the "no component hardcodes user-facing text" guards.
//
// Extracted from `components/plugins/__tests__/plugin-ui-i18n.test.tsx` (§69 / #329) when the
// journal needed the same guard. Two copies would have been two scanners: the journal has 14
// components and the plugins 8, and a dismissal rule added on one side would leave the other
// blind to whatever it was written for.
//
// The question the scan asks is inverted from "which shapes render text": EVERY string in a
// scanned file is suspect, and a string is dismissed only by a rule that proves it is not
// prose — a hex colour, a CSS length, a module path, an i18n key that exists in en.json.
// Enumerating shapes leaks (the first version of that guard missed 9 of 11 real ones); prose
// cannot satisfy a dismissal rule, so it cannot hide in a shape nobody thought of.

/**
 * Shapes that are provably not user-facing prose. Each is a *form*, not a value, so the list
 * does not grow with the code.
 *
 * ‼️ Hangul is checked before these rules, not after: `/^[a-z][a-zA-Z0-9]*$/` and the class-list
 * rule are written about Latin text and say nothing about Korean, and a Korean string in a
 * component is always a missing translation.
 */
const NOT_PROSE: RegExp[] = [
  /^#[0-9a-fA-F]{3,8}$/, // hex colour
  /^-?[\d.]+(px|rem|em|%|vh|vw|s|ms)?$/, // one CSS length
  /^(?:[\d.]+(?:px|rem|em|%)?|0|auto)(?:\s+(?:[\d.]+(?:px|rem|em|%)?|0|auto))+$/, // shorthand
  /^\d+px (solid|dashed)\b/, // border shorthand, colour appended separately
  /^[a-z-]+ [\d.]+m?s$/, // transition shorthand
  /^(var|rgb|rgba|color-mix|linear-gradient|radial-gradient)\(/,
  /^--[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, // CSS custom property NAME
  /^_(blank|self|parent|top)$/, // link target
  /^[a-z][a-zA-Z0-9]*$/, // identifier or CSS keyword
  /^[a-z][a-z0-9]*(?:[-_]+[a-z0-9]+)*(?:\s+[a-z][a-z0-9]*(?:[-_]+[a-z0-9]+)*)*$/, // class list
  /^[a-z]+:[a-z]+$/, // capability id
  /[/@]/, // module path
  /^\[[A-Za-z][\w ]*\]/, // "[Marketplace] …", "[tasks] …" — logger, not UI
  /^translate[XY]?\(/, // transform value
  /^[A-Z][a-z]+[A-Z]\w+$/, // DOM key name: ArrowLeft, PageDown
  /^M-?[\d.]+[, ]-?[\d.]+/, // SVG path data
  /^[a-z]{2}-[A-Z]{2}$/, // BCP-47 tag
  /^\{[a-z]+\}$/, // interpolation placeholder: {count}, {s}
  /^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+\.$/, // i18n key prefix: `tasks.bucket.${…}`
  /^\.[a-z][a-z0-9-]*$/, // file extension or class selector: .md, .tag-suggest-item
  /^[a-z][a-z0-9]*-$/, // React key prefix fragment: `pad-${i}`
  /^(Alt|Cmd|Ctrl|Meta|Mod|Shift)\+/, // keybinding chord
  /^[a-z-]+\($/, // CSS function opening fragment: `repeat(${n}, 10px)`
  /^,?\s*[\d.]+(px|rem|em|%|fr|vh|vw)\)$/, // …and its closing fragment
  /^T\d{2}:\d{2}:\d{2}$/, // ISO time suffix appended to a date
  /^<\/?[a-z]+>$/, // a bare HTML tag wrapping translated text
  /^#t=[\d.]+$/, // media fragment: seek a video poster past frame zero
];

/**
 * `KeyboardEvent.key` values that are one capitalised word.
 *
 * ‼️ Enumerated, NOT matched by a pattern. The first version of this file dismissed
 * `/^[A-Z][a-z]{2,9}$/` to cover Enter and Escape — which also dismissed Install, Cancel,
 * Photos, Videos, Streak, Full and every other one-word BUTTON LABEL. The scanner's own test
 * caught it: three "catches prose" cases went silent. A closed set cannot do that.
 */
const DOM_KEYS = new Set([
  "Alt",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Backspace",
  "Control",
  "Delete",
  "End",
  "Enter",
  "Escape",
  "Home",
  "Meta",
  "PageDown",
  "PageUp",
  "Shift",
  "Tab",
]);

/** Hangul syllables, jamo, and compatibility jamo. */
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

export interface ProseScan {
  children: string[];
  literals: string[];
}

interface Tokens {
  /** Source with comments removed and every string/template/regex blanked out. */
  code: string;
  /** Every string literal and template-literal text chunk. */
  literals: string[];
}

/**
 * Every candidate piece of hardcoded user-facing text in one source file.
 *
 * @param keys i18n keys that exist in en.json — a literal that IS a key is a `t()` argument.
 * @param allowed literals that are neither prose nor a form worth a rule, named one by one.
 */
export function scanForProse(
  source: string,
  keys: Set<string>,
  allowed: Set<string> = new Set(),
): ProseScan {
  const { code, literals } = tokenize(source);
  return {
    children: proseChildren(code, keys, allowed),
    literals: literals
      .map((literal) => literal.trim())
      .filter((value) => isProse(value, keys, allowed)),
  };
}

function isProse(value: string, keys: Set<string>, allowed: Set<string>) {
  if (value === "" || keys.has(value) || allowed.has(value)) return false;
  if (DOM_KEYS.has(value)) return false;
  if (HANGUL.test(value)) return true;
  if (!/[A-Za-z]/.test(value)) return false;
  return !NOT_PROSE.some((shape) => shape.test(value));
}

/**
 * Bare JSX text children — `<button>Install</button>`.
 *
 * Not reachable by the literal scan: a text child is not a string literal.
 */
function proseChildren(code: string, keys: Set<string>, allowed: Set<string>) {
  const found: string[] = [];
  for (const match of code.matchAll(/>([^<>{}]*)</g)) {
    const text = match[1].split(/\s+/).join(" ").trim();
    if (!/[A-Za-z]{3,}/.test(text) && !HANGUL.test(text)) continue;
    // A ternary or conditional boundary between two JSX branches is code, not text:
    // `) : updateAvailable ? (`.
    if (/(&&|\|\||\?|:)\s*\(\s*$/.test(text)) continue;
    if (/^\)\s*:/.test(text)) continue;
    if (/=>|===|\breturn\b|\bconst\b|\bfunction\b|^new [A-Z]/.test(text))
      continue;
    if (keys.has(text) || allowed.has(text)) continue;
    found.push(text);
  }
  return found;
}

/** Index of the closing quote, or -1 if the line ends first. */
function readQuoted(source: string, start: number, quote: string): number {
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "\n") return -1;
    if (c === quote) return i;
  }
  return -1;
}

/** Index of the closing `/` of a regex literal, or -1. A `[…]` class may contain `/`. */
function readRegex(source: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "\n") return -1;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i;
  }
  return -1;
}

/** Template literal: the literal text chunks, with every `${…}` (nesting included) dropped. */
function readTemplate(
  source: string,
  start: number,
): null | { chunks: string[]; end: number } {
  const chunks: string[] = [];
  let chunk = "";
  let depth = 0;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      if (depth === 0) chunk += source[i + 1] ?? "";
      i++;
      continue;
    }
    if (depth === 0 && c === "$" && source[i + 1] === "{") {
      if (chunk) chunks.push(chunk);
      chunk = "";
      depth = 1;
      i++;
      continue;
    }
    if (depth > 0) {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      continue;
    }
    if (c === "`") {
      if (chunk) chunks.push(chunk);
      return { chunks, end: i };
    }
    chunk += c;
  }
  return null;
}

/**
 * A `/` starts a regex when the previous significant character cannot end an expression.
 * Only used so a regex body is skipped rather than parsed — a wrong guess costs nothing more
 * than treating a division as a regex, which blanks a few characters of arithmetic.
 */
function startsRegex(prev: string): boolean {
  return prev === "" || "(,=:[!&|?{};+-*%~^<>".includes(prev);
}

/**
 * Walk the source once, tracking context.
 *
 * ‼️ Not a set of regexes over the whole file. The previous version stripped comments and then
 * paired backticks, so a regex literal *containing* a backtick — `/[*_`[\]]/g`, which is in
 * `JournalDynamicBlock.tsx` — left an odd number of them and desynchronised every template
 * match after it. That does not merely produce noise: the following real prose gets absorbed
 * into one giant bogus chunk and is never reported.
 */
function tokenize(source: string): Tokens {
  const literals: string[] = [];
  let code = "";
  let prev = "";
  let i = 0;

  const advance = (char: string) => {
    code += char;
    if (!/\s/.test(char)) prev = char;
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/"))
        i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = readQuoted(source, i, c);
      // Unterminated before the newline: an apostrophe in JSX prose ("don't"), not a string.
      // Falling through keeps that text in `code`, where the children scan still sees it.
      if (end === -1) {
        advance(c);
        i++;
        continue;
      }
      literals.push(unescape(source.slice(i + 1, end)));
      code += " ";
      prev = '"';
      i = end + 1;
      continue;
    }
    if (c === "`") {
      const template = readTemplate(source, i);
      if (template === null) {
        advance(c);
        i++;
        continue;
      }
      literals.push(...template.chunks);
      code += " ";
      prev = "`";
      i = template.end + 1;
      continue;
    }
    if (c === "/" && startsRegex(prev)) {
      const end = readRegex(source, i);
      if (end !== -1) {
        code += " ";
        prev = "/";
        i = end + 1;
        continue;
      }
    }
    advance(c);
    i++;
  }
  return { code, literals };
}

function unescape(raw: string): string {
  return raw.replace(/\\(.)/g, "$1");
}

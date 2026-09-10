/**
 * Utilities for protecting code blocks during markdown text transformations.
 *
 * Prevents regex replacements from accidentally modifying content inside
 * fenced code blocks (``` ... ```), inline code, or math blocks.
 */

export interface CodeRegion {
  end: number;
  start: number;
}

/** What `collectCodeRegions` protects beyond fences, block math and inline
 *  code. Inline math is opt-in: a converter that REWRITES `$…$` (the Notion
 *  export) must still see it, while one that must not touch it (the Pandoc
 *  sub/superscript pass, issue 544) asks for it to be protected. */
export interface CodeRegionOptions {
  inlineMath?: boolean;
  /** Protect HTML tags and markdown link/image destinations too — a
   *  `~…~` inside `<img src="img/~draft file~.png">` or `](…)` is a path,
   *  not a mark (issue 544). */
  markup?: boolean;
}

/**
 * Collect start/end offsets of all fenced code blocks, block math, and
 * inline code spans in content.
 */
export function collectCodeRegions(
  md: string,
  options: CodeRegionOptions = {},
): CodeRegion[] {
  const regions: CodeRegion[] = [...fencedCodeRegions(md)];

  // Block math: $$...$$ (multiline)
  const blockMathRe = /\$\$[\s\S]*?\$\$/g;
  let m: null | RegExpExecArray;
  while ((m = blockMathRe.exec(md)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  // Inline code: `...`
  const inlineCodeRe = /`[^`\n]+`/g;
  while ((m = inlineCodeRe.exec(md)) !== null) {
    regions.push({ start: m.index, end: m.index + m[0].length });
  }

  if (options.inlineMath) {
    for (const r of inlineMathRegions(md)) {
      if (!isInCodeRegion(r.start, regions)) regions.push(r);
    }
  }

  if (options.markup) {
    // An HTML tag — a live `<`, a real tag name, attributes, `>` — and a
    // link/image destination: their text is markup or a path, and a `~`/`^`
    // there is never a mark. `\<u~a b~>` is prose with an escaped `<`.
    const tagRe = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>\n]*)?\/?>/g;
    while ((m = tagRe.exec(md)) !== null) {
      if (isLive(md, m.index)) {
        regions.push({ start: m.index, end: m.index + m[0].length });
      }
    }
    const destinationRe = /\]\((?:[^()\n\\]|\\.|\([^()\n]*\))*\)/g;
    while ((m = destinationRe.exec(md)) !== null) {
      regions.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  return regions;
}

/** Is the character at `index` live — preceded by an even run of backslashes? */
function isLive(md: string, index: number): boolean {
  let run = 0;
  for (let j = index - 1; j >= 0 && md[j] === "\\"; j--) run += 1;
  return run % 2 === 0;
}

/**
 * Fenced code blocks (``` or ~~~), by CommonMark's line rules rather than a
 * single regex: the opener may sit behind a container prefix (blockquote
 * markers, list indentation), the closer must sit behind the SAME number of
 * blockquote markers and use the same fence character with at least the
 * opener's length, and an unclosed fence runs to the end of the document.
 * A regex that accepted any prefix on the closer took a `> ```` line inside
 * a column-zero block as its end and exposed the rest of the code.
 */
function fencedCodeRegions(md: string): CodeRegion[] {
  const regions: CodeRegion[] = [];
  const prefixRe = /^([ \t]*(?:>[ \t]*)*)/;
  let open: null | { char: string; gt: number; len: number; start: number } =
    null;
  let offset = 0;
  for (const line of md.split("\n")) {
    const prefix = prefixRe.exec(line)![1];
    const gt = (prefix.match(/>/g) ?? []).length;
    const rest = line.slice(prefix.length);
    if (open === null) {
      const o = /^(`{3,}|~{3,})/.exec(rest);
      if (o !== null) {
        open = { char: o[1][0], gt, len: o[1].length, start: offset };
      }
    } else if (gt === open.gt) {
      const c = /^(`{3,}|~{3,})[ \t]*$/.exec(rest);
      if (c !== null && c[1][0] === open.char && c[1].length >= open.len) {
        regions.push({ start: open.start, end: offset + line.length });
        open = null;
      }
    }
    offset += line.length + 1;
  }
  if (open !== null) regions.push({ start: open.start, end: md.length });
  return regions;
}

/**
 * Inline math by pandoc's `tex_math_dollars` rule: the opener is a live `$`
 * (even backslash run before it, so `\\$` is a backslash then math) not
 * followed by a space, the closer is a live `$` not preceded by a space nor
 * followed by a digit, and the span may cross a line break but not a blank
 * line.
 */
function inlineMathRegions(md: string): CodeRegion[] {
  const regions: CodeRegion[] = [];
  let i = 0;
  while (i < md.length) {
    if (md[i] !== "$" || !isLive(md, i) || /\s/.test(md[i + 1] ?? " ")) {
      i += 1;
      continue;
    }
    let j = i + 1;
    let closed = -1;
    while (j < md.length) {
      const ch = md[j];
      if (ch === "\n" && md[j + 1] === "\n") break;
      if (ch === "$" && isLive(md, j)) {
        if (!/\s/.test(md[j - 1]) && !/\d/.test(md[j + 1] ?? "")) {
          closed = j;
        }
        break;
      }
      j += 1;
    }
    if (closed === -1) {
      i += 1;
      continue;
    }
    regions.push({ start: i, end: closed + 1 });
    i = closed + 1;
  }
  return regions;
}

/**
 * Returns true if the given offset falls inside any code region.
 */
export function isInCodeRegion(pos: number, regions: CodeRegion[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

/** Does the span `[start, end)` touch any code region? A match that merely
 *  STARTS outside code can still swallow a code span whole (`~a \`x y\` b~`),
 *  and a replacement that rewrites the code's contents is exactly what the
 *  regions exist to prevent. */
export function overlapsCodeRegion(
  start: number,
  end: number,
  regions: CodeRegion[],
): boolean {
  return regions.some((r) => start < r.end && end > r.start);
}

/**
 * Apply a regex replacement only to text outside fenced code blocks,
 * inline code, and math blocks.
 * The replacer receives the same arguments as a String.replace callback.
 */
export function replaceOutsideCode(
  md: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
  options: CodeRegionOptions = {},
): string {
  const regions = collectCodeRegions(md, options);
  // Ensure the regex is global
  const globalRe = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g",
  );
  return md.replace(globalRe, (match: string, ...args: unknown[]) => {
    // String.replace passes: match, ...groups, offset, originalString
    // offset is the second-to-last argument
    const offset = args[args.length - 2] as number;
    if (overlapsCodeRegion(offset, offset + match.length, regions)) {
      return match;
    }
    return replacer(match, ...(args.slice(0, -2) as string[]));
  });
}

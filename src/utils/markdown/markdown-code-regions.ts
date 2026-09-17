/**
 * Utilities for protecting code blocks during markdown text transformations.
 *
 * Prevents regex replacements from accidentally modifying content inside
 * fenced code blocks (``` ... ```), inline code, or math blocks — and, since
 * issue 636, lets a replacement PAIR its delimiters across such a region the
 * way the editor does: a match is found on a shadow of the text in which
 * every protected region is filler, and rewritten on the original text.
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

/** How {@link replaceOutsideCode} judges a match that touches a region.
 *
 *  `"span"` (the default) refuses ANY overlap. It is the rule for a replacer
 *  that rewrites the match's INTERIOR — the sub/superscript passes escape
 *  the spaces inside it, so a swallowed code span (`~a \`x y\` b~`) would
 *  have its own bytes rewritten. A refused match is consumed, as the editor
 *  consumes a pair it rejects: its closer is not offered to a later opener.
 *
 *  `"delimiters"` refuses only when one of the match's own ends sits inside
 *  a region. It is the rule for a replacer that keeps the interior verbatim
 *  and swaps the delimiters alone (highlight `==x==` → `**x**`, Notion's
 *  `$x$` → `$$x$$`): a mark WRAPPING a code span, a link or a tag is
 *  ordinary authoring and must still convert, while a delimiter landing
 *  inside code (`a ==b \`c== d\` e`) must not. On the shadow the match is
 *  found on, a delimiter inside a region is filler and can never be one, so
 *  the check is a guard against a pattern that matches the filler itself. */
export type MatchGuard = "delimiters" | "span";

export interface ReplaceOutsideCodeOptions extends CodeRegionOptions {
  guard?: MatchGuard;
}

/** A source line: `[start, end)` is its text, `[end, next)` its break. */
export interface SourceLine {
  end: number;
  next: number;
  start: number;
}

/** The lines of `md` by CommonMark's breaks — `\n`, `\r\n` and a lone `\r`
 *  — with their offsets, the last line ending at the text's end (empty after
 *  a final break, as `split("\n")` had it). */
export function splitLines(md: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (let i = 0; i < md.length; i++) {
    const c = md.charCodeAt(i);
    if (c === 10) {
      lines.push({ end: i, next: i + 1, start });
      start = i + 1;
    } else if (c === 13) {
      const next = md.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      lines.push({ end: i, next, start });
      i = next - 1;
      start = next;
    }
  }
  lines.push({ end: md.length, next: md.length, start });
  return lines;
}

/** The filler a protected region becomes on the shadow: one code unit per
 *  code unit, so every offset of the shadow is an offset of the text; line
 *  breaks stay, so a pattern that cannot cross a line still cannot. Private
 *  use, matched by no delimiter of any converter. */
const FILLER = "";

/** `md` with every region's characters replaced by {@link FILLER}, its line
 *  breaks kept. `regions` must be sorted and non-overlapping. */
function blankRegions(md: string, regions: readonly CodeRegion[]): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const { end, start } of regions) {
    parts.push(
      md.slice(cursor, start),
      md.slice(start, end).replace(/[^\r\n]/g, FILLER),
    );
    cursor = end;
  }
  parts.push(md.slice(cursor));
  return parts.join("");
}

/** `regions` sorted by start, overlapping and touching ones merged. */
function mergeRegions(regions: readonly CodeRegion[]): CodeRegion[] {
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const merged: CodeRegion[] = [];
  for (const region of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && region.start <= last.end) {
      if (region.end > last.end) last.end = region.end;
    } else {
      merged.push({ end: region.end, start: region.start });
    }
  }
  return merged;
}

/**
 * Collect start/end offsets of all fenced code blocks and display math
 * blocks, inline code spans and (per options) inline math, HTML tags and
 * link destinations in content. Sorted and merged.
 */
export function collectCodeRegions(
  md: string,
  options: CodeRegionOptions = {},
): CodeRegion[] {
  const lines = splitLines(md);
  // Sorted, not merged: a candidate that begins inside another the scanner
  // honoured is that one's text, not a region of its own — a link
  // destination inside a fence, say.
  const skip = [
    ...fencedCodeRegions(md, lines),
    ...(options.markup ? markupRegions(md) : []),
  ].sort((a, b) => a.start - b.start);
  const regions: CodeRegion[] = [];
  for (const span of inlineSpans(md, lines, { mathCrossesLines: true, skip })) {
    // Inline math with one dollar is the Notion converter's to rewrite unless
    // the caller asks for it; `$$…$$` is protected as block math always was.
    if (span.kind === "math" && span.n === 1 && !options.inlineMath) continue;
    regions.push({ end: span.end, start: span.start });
  }
  return mergeRegions(regions);
}

/** Is the character at `index` live — preceded by an even run of backslashes? */
export function isLive(md: string, index: number): boolean {
  let run = 0;
  for (let j = index - 1; j >= 0 && md[j] === "\\"; j--) run += 1;
  return run % 2 === 0;
}

/**
 * Fenced code blocks (``` or ~~~) and display math (`$$`, remark-math's
 * flow rule), by pandoc's line rules rather than a single regex: the opener
 * may sit behind a container prefix (blockquote markers, list markers,
 * indentation), the closer must sit behind the SAME number of blockquote
 * markers and use the same fence character with at least the opener's
 * length, and an unclosed block runs to the end of the document. A block
 * opened on a list item's own line (`- ````, `- $$`) ends with the item:
 * the next list marker at a shallower column starts a new item (and may
 * open the next block), while a less indented closer still closes it
 * (pandoc gathers such lines into the item). A line carrying a list marker
 * is never a closer. A regex that accepted any prefix on the closer took a
 * `> ```` line inside a column-zero block as its end and exposed the rest of
 * the code. A `$$` opener is a line of nothing but the run: `$$x$$` on one
 * line is inline math, the scanner's, and so is the `$$_{a\nb}$$` the
 * Notion subscript pass writes across a line break — a `$$ meta` line the
 * editor would read as a block is not one here, and the editor never
 * writes one. Lines are read without
 * their break, so a CRLF or lone-CR file closes its blocks too (issue 636).
 * Indentation of four or more is read as a prefix here, not as indented
 * code — the approximation the fence rule always made.
 */
function fencedCodeRegions(
  md: string,
  lines: readonly SourceLine[],
): CodeRegion[] {
  const regions: CodeRegion[] = [];
  // A container prefix: blockquote markers and list markers (`-` `*` `+`,
  // `1.` `1)` — each followed by a space) in any mix, with their
  // indentation.
  const prefixRe = /^([ \t]*(?:(?:>|(?:[-*+]|\d{1,9}[.)])(?=[ \t]))[ \t]*)*)/;
  const markerRe = /(?:[-*+]|\d{1,9}[.)])[ \t]/;
  let open: null | {
    char: string;
    column: null | number;
    gt: number;
    len: number;
    start: number;
  } = null;
  for (const { end, start } of lines) {
    const line = md.slice(start, end);
    const prefix = prefixRe.exec(line)![1];
    const gt = (prefix.match(/>/g) ?? []).length;
    const rest = line.slice(prefix.length);
    // Past the last blockquote marker: where a list marker sits, and where
    // an item's content starts (after the marker and its space).
    const afterQuote = prefix.slice(prefix.lastIndexOf(">") + 1);
    const marker = markerRe.exec(afterQuote);
    if (
      open !== null &&
      open.column !== null &&
      gt === open.gt &&
      marker !== null &&
      marker.index < open.column
    ) {
      regions.push({ end: start, start: open.start });
      open = null;
    }
    if (open === null) {
      const o = /^(`{3,}|~{3,}|\${2,})/.exec(rest);
      if (
        o !== null &&
        (o[1][0] !== "$" || /^[ \t]*$/.test(rest.slice(o[1].length)))
      ) {
        open = {
          char: o[1][0],
          column: marker === null ? null : afterQuote.length,
          gt,
          len: o[1].length,
          start,
        };
      }
    } else if (gt === open.gt && marker === null) {
      const c = /^(`{3,}|~{3,}|\${2,})[ \t]*$/.exec(rest);
      if (c !== null && c[1][0] === open.char && c[1].length >= open.len) {
        regions.push({ end, start: open.start });
        open = null;
      }
    }
  }
  if (open !== null) regions.push({ end: md.length, start: open.start });
  return regions;
}

/** HTML tags, link/image destinations and reference definitions — their
 *  text is markup or a path, and a `~`/`^` there is never a mark. */
function markupRegions(md: string): CodeRegion[] {
  const regions: CodeRegion[] = [];
  let m: null | RegExpExecArray;
  // An HTML tag — a live `<`, a real tag name, attributes, `>`. `\<u~a b~>`
  // is prose with an escaped `<`.
  //
  // Attributes are matched by their own grammar rather than "anything up
  // to the next `>`", because a QUOTED VALUE may hold one: with
  // `[^<>\n]*` the region of `<img alt="x>y" src="p/~a b~.png">` stopped
  // at the `>` inside `alt`, leaving the `src` path exposed to the mark
  // rewriters — the very failure this option exists to prevent.
  const tagRe =
    /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^\s"'/=<>]+(?:\s*=\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s"'`=<>]+))?)*\s*\/?>/g;
  while ((m = tagRe.exec(md)) !== null) {
    if (isLive(md, m.index)) {
      regions.push({ end: m.index + m[0].length, start: m.index });
    }
  }
  const destinationRe = /\]\((?:[^()\n\\]|\\.|\([^()\n]*\))*\)/g;
  while ((m = destinationRe.exec(md)) !== null) {
    regions.push({ end: m.index + m[0].length, start: m.index });
  }
  // A link/image REFERENCE definition — `[id]: dest "title"`. Its
  // destination is a path exactly as an inline one is, and
  // `export-markdown-images.ts` walks `definition` nodes, so a
  // reference-style image is a supported input: a `\ ` injected here names
  // no file and the image is silently reduced to its alt text.
  const definitionRe =
    /^ {0,3}\[(?:[^\]\\\n]|\\.)*\]:[ \t]*(?:<[^>\n]*>|\S+)/gm;
  while ((m = definitionRe.exec(md)) !== null) {
    regions.push({ end: m.index + m[0].length, start: m.index });
  }
  return regions;
}

/** A span the inline scanner found: a code span, an inline math span with
 *  `n` dollars, or a skip region it honoured. */
export interface InlineSpan extends CodeRegion {
  kind: "code" | "math" | "skip";
  n: number;
}

export interface InlineSpanOptions {
  /** May a `$…$` pair cross a line break? The Pandoc protection lets a
   *  formula run to a blank line, as it always did; the Notion converter
   *  pairs within a line, as its regex did. */
  mathCrossesLines: boolean;
  /** Regions the scanner steps over while nothing is open — fences,
   *  display math blocks, markup. One that begins inside an open code span
   *  or formula, or inside a region already honoured, is that one's text
   *  and is dropped, so a `\`` inside a link destination still closes the
   *  span that began before it. Sorted by start; they may overlap. */
  skip: readonly CodeRegion[];
}

/**
 * Code spans and inline math the way the editor's parser reads them
 * (issue 636): left to right, a live run of backticks opens a code span
 * and a live run of dollars opens a formula — whichever opens first wins,
 * and every delimiter inside it is its text — closed by the next run of
 * the SAME kind and length, before a blank line (a formula also before the
 * line's end when `mathCrossesLines` is off); a run nothing closes is text,
 * and the scan goes on behind it. A backslash counts only before an opener:
 * it shortens the run by one (`\$$x$` is a dollar and the formula `x`),
 * and inside a construct it is text (`$x\$` closes at its last dollar).
 *
 * Linear: the runs are indexed once by kind and length, and every cursor —
 * over runs, lines, blank lines, skip regions — moves forward only.
 */
export function inlineSpans(
  md: string,
  lines: readonly SourceLine[],
  options: InlineSpanOptions,
): InlineSpan[] {
  const { mathCrossesLines, skip } = options;
  interface Run {
    end: number;
    kind: "code" | "math";
    start: number;
  }
  const runs: Run[] = [];
  const runRe = /`+|\$+/g;
  let m: null | RegExpExecArray;
  while ((m = runRe.exec(md)) !== null) {
    runs.push({
      end: m.index + m[0].length,
      kind: m[0][0] === "`" ? "code" : "math",
      start: m.index,
    });
  }
  // Every run by kind and length, in order, for the closer lookups.
  const byKey = new Map<string, number[]>();
  runs.forEach((run, k) => {
    const key = `${run.kind}:${run.end - run.start}`;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [k]);
    else list.push(k);
  });
  const keyCursor = new Map<string, number>();
  // Blank lines end a paragraph — and any construct still open in it. A
  // line of blockquote markers alone (`>`) is blank inside its quote, as
  // the editor reads it.
  const blanks: number[] = [];
  for (const line of lines) {
    if (/^[ \t>]*$/.test(md.slice(line.start, line.end)))
      blanks.push(line.start);
  }
  let b = 0;
  const paragraphEnd = (at: number): number => {
    while (b < blanks.length && blanks[b] <= at) b++;
    return b < blanks.length ? blanks[b] : md.length;
  };
  let l = 0;
  const lineEnd = (at: number): number => {
    while (l < lines.length && lines[l].next <= at) l++;
    return l < lines.length ? lines[l].end : md.length;
  };

  const spans: InlineSpan[] = [];
  let s = 0;
  // Honour a region: the candidates beginning inside it are its text.
  const honour = (region: CodeRegion) => {
    spans.push({ end: region.end, kind: "skip", n: 0, start: region.start });
    s++;
    while (s < skip.length && skip[s].start < region.end) s++;
  };
  let k = 0;
  while (k < runs.length) {
    const run = runs[k];
    // Skip regions wholly before this run are honoured; one holding the
    // run's start is honoured and the runs inside it are its text.
    while (s < skip.length && skip[s].end <= run.start) honour(skip[s]);
    if (s < skip.length && skip[s].start <= run.start) {
      const region = skip[s];
      honour(region);
      while (k < runs.length && runs[k].start < region.end) k++;
      continue;
    }
    // An opener: its first character escaped, the run is one shorter.
    const live = isLive(md, run.start);
    const start = live ? run.start : run.start + 1;
    const n = run.end - start;
    if (n === 0) {
      k++;
      continue;
    }
    const limit =
      run.kind === "math" && !mathCrossesLines
        ? lineEnd(start)
        : paragraphEnd(start);
    const key = `${run.kind}:${n}`;
    const list = byKey.get(key) ?? [];
    let c = keyCursor.get(key) ?? 0;
    while (c < list.length && runs[list[c]].start < run.end) c++;
    keyCursor.set(key, c);
    const closer = c < list.length ? runs[list[c]] : undefined;
    if (closer === undefined || closer.start >= limit) {
      k++;
      continue;
    }
    spans.push({ end: closer.end, kind: run.kind, n, start });
    // Skip regions that began inside the construct were its text.
    while (s < skip.length && skip[s].start < closer.end) s++;
    while (k < runs.length && runs[k].start < closer.end) k++;
  }
  while (s < skip.length) honour(skip[s]);
  return spans;
}

/** The inline math spans written with one dollar — `$…$` within a line,
 *  fences and display math blocks stepped over — for a converter that
 *  rewrites them (the Notion export). */
export function inlineMathSpans(md: string): CodeRegion[] {
  const lines = splitLines(md);
  const skip = fencedCodeRegions(md, lines);
  return inlineSpans(md, lines, { mathCrossesLines: false, skip })
    .filter((span) => span.kind === "math" && span.n === 1)
    .map(({ end, start }) => ({ end, start }));
}

/**
 * Returns true if the given offset falls inside any code region.
 */
export function isInCodeRegion(pos: number, regions: CodeRegion[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

/**
 * Apply a regex replacement only to text outside fenced code blocks,
 * inline code, and math blocks. The replacer receives the same arguments as
 * a String.replace callback — the match and its groups as they stand in
 * the ORIGINAL text.
 *
 * The match is found on a shadow of the text in which every protected
 * region is filler (issue 636): a delimiter inside code is invisible, so a
 * pair that wraps a code span is found as a pair, and a delimiter inside
 * code is never taken for a closer and then thrown away with the real one
 * behind it. The shadow keeps every line break, so whether a pattern may
 * cross one is the pattern's own affair, as before: Notion's sub/superscript
 * cross a soft break, as the editor's marks do; the highlight does not. A
 * refused match is consumed.
 */
export function replaceOutsideCode(
  md: string,
  pattern: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
  options: ReplaceOutsideCodeOptions = {},
): string {
  const regions = collectCodeRegions(md, options);
  const shadow = blankRegions(md, regions);
  // A cursor over the sorted regions: matches come in text order.
  let r = 0;
  const holds = (pos: number): boolean => {
    while (r < regions.length && regions[r].end <= pos) r++;
    return r < regions.length && regions[r].start <= pos;
  };
  const blocked =
    options.guard === "delimiters"
      ? (start: number, end: number) => holds(start) || holds(end - 1)
      : (start: number, end: number) => {
          while (r < regions.length && regions[r].end <= start) r++;
          return r < regions.length && regions[r].start < end;
        };
  let flags = pattern.flags;
  if (!flags.includes("g")) flags += "g";
  if (!flags.includes("d")) flags += "d";
  const re = new RegExp(pattern.source, flags);
  const parts: string[] = [];
  let last = 0;
  let m: null | RegExpExecArray;
  while ((m = re.exec(shadow)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const ms = m.index;
    const me = ms + m[0].length;
    if (blocked(ms, me)) continue;
    // Every group as the original text holds it; a group that did not
    // take part stays undefined, as String.replace passes it.
    const indices = m.indices ?? [];
    const groups = indices
      .slice(1)
      .map((pair) =>
        pair === undefined ? undefined : md.slice(pair[0], pair[1]),
      );
    parts.push(
      md.slice(last, ms),
      replacer(md.slice(ms, me), ...(groups as string[])),
    );
    last = me;
  }
  parts.push(md.slice(last));
  return parts.join("");
}

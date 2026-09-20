/**
 * Utilities for protecting code blocks during markdown text transformations.
 *
 * Prevents regex replacements from accidentally modifying content inside
 * fenced code blocks (``` ... ```), inline code, or math blocks — and, since
 * issue 636, lets a replacement PAIR its delimiters across such a region the
 * way the editor does: a match is found on a shadow of the text in which
 * every protected region is filler, and rewritten on the original text.
 *
 * The regions come from three scanners this module composes: the block
 * scanner (`markdown-block-regions.ts` — fences, display math), the markup
 * scanner (`markdown-markup-regions.ts` — tags, destinations, definitions)
 * and the inline scanner (`markdown-inline-spans.ts` — code spans, inline
 * math). `markdown-source.ts` holds what they and the converters share.
 */

import { fencedCodeRegions } from "./markdown-block-regions";
import { inlineSpans } from "./markdown-inline-spans";
import { markupRegions } from "./markdown-markup-regions";
import { type CodeRegion, splitLines } from "./markdown-source";

/** What `collectCodeRegions` protects beyond fences, block math and inline
 *  code. Inline math is opt-in: a converter that REWRITES `$…$` (the Notion
 *  export) must still see it, while one that must not touch it (the Pandoc
 *  sub/superscript pass, issue 544) asks for it to be protected. */
export interface CodeRegionOptions {
  inlineMath?: boolean;
  /** Protect HTML tags, markdown link/image destinations and reference
   *  definitions too — a `~…~` inside `<img src="img/~draft file~.png">`,
   *  `](…)` or `[id]: …` is a path, not a mark (issue 544). */
  markup?: boolean;
}

/** How {@link replaceOutsideCode} judges a match that touches a region.
 *
 *  `"span"` (the default) refuses ANY overlap. It is the rule for a replacer
 *  that rewrites the match's INTERIOR — the pandoc sub/superscript passes
 *  escape the spaces inside it, so a swallowed code span (`~a \`x y\` b~`)
 *  would have its own bytes rewritten; the Notion ones map it to Unicode,
 *  or keep it verbatim in a `$$_{…}$$` wrapper that is math to every
 *  later pass. A refused match is consumed, as the editor consumes a pair
 *  it rejects: its closer is not offered to a later opener.
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

/** The filler a protected region becomes on the shadow: one code unit per
 *  code unit, so every offset of the shadow is an offset of the text; line
 *  breaks stay, so a pattern that cannot cross a line still cannot. Private
 *  use, matched by no delimiter of any converter. Written as an escape:
 *  the bare character is invisible in an editor and was once dropped when
 *  the file was retyped, which emptied every region on the shadow. */
const FILLER = "\uE000";

/** `md` with every region's characters replaced by {@link FILLER}, its line
 *  breaks kept. `regions` must be sorted and non-overlapping, or the shadow
 *  would carry a region's filler twice and grow; `collectCodeRegions`
 *  checks that (`orderedRegions`) before handing them over. */
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

/** `regions` as given, once each begins at or past the end of the one
 *  before it and at or before its own end — the inline scanner's output
 *  contract, which the consumers rely on and nothing re-establishes: the
 *  shadow would carry a region's filler twice and grow, the Notion math
 *  pass would copy text twice, and every later offset would point at the
 *  wrong byte of the original, silently. A merge step once hid such a
 *  fault instead of reporting it, and fused touching regions on the way
 *  (issue 691). So the fault is an error the export surfaces. */
export function orderedRegions<R extends readonly CodeRegion[]>(regions: R): R {
  let cursor = 0;
  for (const { end, start } of regions) {
    if (start < cursor) {
      throw new Error(
        `code region [${start}, ${end}) begins before the last one ended at ${cursor}`,
      );
    }
    if (end < start) {
      throw new Error(`code region [${start}, ${end}) ends before it begins`);
    }
    cursor = end;
  }
  return regions;
}

/**
 * Collect start/end offsets of all fenced code blocks and display math
 * blocks, inline code spans and (per options) inline math, HTML tags and
 * link destinations in content. Sorted and non-overlapping, as the inline
 * scanner yields them, and each region starts where its construct does:
 * a region's START is part of the contract — `balanceBrackets` (pandoc
 * underline) tells a destination by the `](` it starts with, and a merge
 * step that once fused a code span flush against one hid that start (a
 * `]` inside the code was escaped on one side, the link's `[` on the
 * other). No merging, then: touching regions stay apart.
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
  return orderedRegions(regions);
}

/** The inline math spans written with one dollar — `$…$` within a line,
 *  fences, display math blocks and markup stepped over — for a converter
 *  that rewrites them (the Notion export). A `$` inside a link destination
 *  or a tag is a path's character, not an opener (issue 544): two URLs
 *  with a `$` each paired across their destinations. */
export function inlineMathSpans(md: string): CodeRegion[] {
  const lines = splitLines(md);
  const skip = [...fencedCodeRegions(md, lines), ...markupRegions(md)].sort(
    (a, b) => a.start - b.start,
  );
  return orderedRegions(
    inlineSpans(md, lines, { mathCrossesLines: false, skip })
      .filter((span) => span.kind === "math" && span.n === 1)
      .map(({ end, start }) => ({ end, start })),
  );
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
  // A cursor over the sorted regions: matches come in text order. Both
  // closures below advance it, but only one of them runs per call.
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

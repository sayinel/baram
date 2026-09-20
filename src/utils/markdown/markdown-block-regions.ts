/**
 * The block-level regions a converter must not rewrite: fenced code blocks
 * and display math, read line by line with their container prefixes (issue
 * 636). `markdown-code-regions.ts` composes them with the inline scanner.
 */

import type { CodeRegion, SourceLine } from "./markdown-source";

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
 * writes one. Lines are read without their break, so a CRLF or lone-CR
 * file closes its blocks too (issue 636). Indentation of four or more is
 * read as a prefix here, not as indented code — the approximation the
 * fence rule always made.
 */
export function fencedCodeRegions(
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

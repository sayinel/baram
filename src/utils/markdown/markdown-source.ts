/**
 * The source text as the region scanners read it (issue 636): a region is a
 * half-open range of code-unit offsets, a line is its text and its break,
 * and a character is live when an even run of backslashes precedes it.
 */

export interface CodeRegion {
  end: number;
  start: number;
}

/** The body of a blank line, as a regex fragment: blanks, or blockquote
 *  markers alone — a `>` line is blank inside its quote, as the editor reads
 *  it. A blank line ends a paragraph and every inline construct open in it;
 *  the inline scanner and the Notion mark patterns share this one reading.
 *  It must stay free of capturing groups: the mark patterns read their
 *  groups by number. */
export const BLANK_LINE_BODY = String.raw`[ \t>]*`;

/** A source line: `[start, end)` is its text, `[end, next)` its break. */
export interface SourceLine {
  end: number;
  next: number;
  start: number;
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

/** Is the character at `index` live — preceded by an even run of backslashes? */
export function isLive(md: string, index: number): boolean {
  let run = 0;
  for (let j = index - 1; j >= 0 && md[j] === "\\"; j--) run += 1;
  return run % 2 === 0;
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

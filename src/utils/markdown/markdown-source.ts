/**
 * The source text as the region scanners and the export converters read it
 * (issue 636): a region is a half-open range of code-unit offsets, a line
 * is its text and its break, a blank line is blanks or blockquote markers
 * alone, and a character is live when an even run of backslashes precedes
 * it.
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

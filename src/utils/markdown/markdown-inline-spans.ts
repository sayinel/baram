/**
 * The inline scanner: code spans and inline math paired the way the
 * editor's parser pairs them (issue 636), stepping over the block and markup
 * regions it is handed. `markdown-code-regions.ts` composes it.
 */

import {
  BLANK_LINE_BODY,
  type CodeRegion,
  isLive,
  type SourceLine,
} from "./markdown-source";

const BLANK_LINE = new RegExp(`^${BLANK_LINE_BODY}$`);

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

/** A run of backticks or dollars, as the source holds it. */
interface Run {
  end: number;
  kind: "code" | "math";
  start: number;
}

/** Every run of `md` in order, and each run's index under its kind and
 *  length — the closer lookups. */
function indexRuns(md: string): { byKey: Map<string, number[]>; runs: Run[] } {
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
  const byKey = new Map<string, number[]>();
  runs.forEach((run, k) => {
    const key = `${run.kind}:${run.end - run.start}`;
    const list = byKey.get(key);
    if (list === undefined) byKey.set(key, [k]);
    else list.push(k);
  });
  return { byKey, runs };
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
 *
 * Output contract: the spans come sorted by start and non-overlapping —
 * each begins at or past the end of the one before it (touching is
 * ordinary: `[a](p)\`x\``). A skip candidate that begins inside an honoured
 * region, or inside an open code span or formula, is dropped as that
 * construct's text, and the skip cursor `s` and the run cursor `k` only
 * ever advance past what was emitted; `skip` itself must be sorted by
 * start. The shadow and the Notion math pass rely on this order, and
 * `collectCodeRegions` and `inlineMathSpans` check it (`orderedRegions`)
 * instead of merging — a merge step once fused touching regions and hid a
 * destination's start.
 */
export function inlineSpans(
  md: string,
  lines: readonly SourceLine[],
  options: InlineSpanOptions,
): InlineSpan[] {
  const { mathCrossesLines, skip } = options;
  const { byKey, runs } = indexRuns(md);
  const keyCursor = new Map<string, number>();
  // Blank lines end a paragraph — and any construct still open in it.
  const blanks: number[] = [];
  for (const line of lines) {
    if (BLANK_LINE.test(md.slice(line.start, line.end)))
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

// issue 631 — offsets in an html node's text → offsets in the markdown source.
//
// The parser hands an html node's text with the container prefix of every
// continuation line (`> `, list indentation) removed, and a tab that ends a
// prefix expanded to spaces, so an offset found in that text (a tag the
// export will rewrite, export-html-fragment.ts) cannot be spliced into the
// source as it is. This mapper aligns the text's lines with the source's and
// gives up rather than guess when they do not match.

/** A line terminator as the parser reads it — LF, CRLF or a lone CR. Not
 *  global: safe to `split` by and to `test` from any module. */
export const LINE_END = /\r\n|\r|\n/;
/** The same terminator, searched from `lastIndex`; this module's own. */
const LINE_END_FROM = new RegExp(LINE_END.source, "g");

/** Where a line of the node's text begins, and where the same line begins
 *  in the source. An offset in the text maps to the line's anchor plus its
 *  distance into the line. */
interface LineAnchor {
  sourceOffset: number;
  valueOffset: number;
}

/**
 * Offsets in an html node's text → offsets in the source. The text is the
 * source with the container prefix of every continuation line (`> `, list
 * indentation) removed, so a middle line of the text is the tail of its
 * source line, and the last line sits after the same prefix as the line
 * before it. Returns null when the lines cannot be aligned — the caller then
 * leaves the node alone rather than guess.
 */
export function valueToSource(
  value: string,
  source: string,
  startOffset: number,
): ((offset: number) => number) | null {
  const anchors = alignLines(value, source, startOffset);
  if (anchors === null) return null;
  return (offset: number): number => {
    let k = anchors.length - 1;
    while (k > 0 && anchors[k].valueOffset > offset) k -= 1;
    const { sourceOffset, valueOffset } = anchors[k];
    // Blanks the parser synthesised before a line's first character (an
    // expanded tab) have no source of their own: they map to that character.
    return sourceOffset + Math.max(0, offset - valueOffset);
  };
}

/** One anchor per line of `value`, or null at the first line that cannot be
 *  found where the layout says it must be. */
function alignLines(
  value: string,
  source: string,
  startOffset: number,
): LineAnchor[] | null {
  // Lines end in LF, CRLF or a lone CR — the parser reads all three, and
  // keeps each as written, so the same terminator is looked for in the source.
  const lines = value.split(LINE_END);
  const anchors: LineAnchor[] = [];
  let valueAt = 0; // where the current line begins in `value`
  let cursor = startOffset; // where the current source line begins
  let prefix = 0; // container prefix length of the previous line
  for (const [k, line] of lines.entries()) {
    LINE_END_FROM.lastIndex = cursor;
    const terminator = LINE_END_FROM.exec(source);
    const lineEnd = terminator === null ? source.length : terminator.index;
    const delimiter = terminator === null ? 1 : terminator[0].length;
    const place = k === 0 ? "first" : k < lines.length - 1 ? "middle" : "last";
    const anchor = alignLine(place, line, { cursor, lineEnd, prefix, source });
    if (anchor === null) return null;
    if (place === "middle") prefix = anchor.sourceOffset - cursor;
    anchors.push({
      sourceOffset: anchor.sourceOffset,
      valueOffset: valueAt + anchor.lead,
    });
    valueAt += line.length + delimiter;
    cursor = lineEnd + delimiter;
  }
  return anchors;
}

/** The source line the current line of the text is aligned against. */
interface SourceLine {
  /** Where the source line begins. */
  cursor: number;
  /** Where its terminator (or the source) ends it. */
  lineEnd: number;
  /** The container prefix length of the line before it. */
  prefix: number;
  source: string;
}

/**
 * Where `line` begins in its source line, and how many of the line's
 * leading blanks the anchor skips. The parser expands a leading tab to
 * spaces, so a line of the text may begin with more blanks than its source
 * line: every line is aligned on its first non-blank character, and the
 * blanks before it map to that same spot (no tag starts or ends in them).
 * Only the first line is tried as written first, since its blanks are
 * usually its own. Null when the line is not where the layout puts it.
 */
function alignLine(
  place: "first" | "last" | "middle",
  line: string,
  { cursor, lineEnd, prefix, source }: SourceLine,
): null | { lead: number; sourceOffset: number } {
  const lead = /^[ \t]*/.exec(line)![0].length;
  const body = line.slice(lead);
  if (place === "first") {
    // `startOffset` already sits past a tab that ends the container prefix
    // (`>\t<img` → `  <img`): the synthesised blanks, if any, map to it.
    if (source.startsWith(line, cursor))
      return { lead: 0, sourceOffset: cursor };
    return source.startsWith(body, cursor)
      ? { lead, sourceOffset: cursor }
      : null;
  }
  if (place === "middle") {
    // The tail of its source line: whatever precedes it is the prefix.
    const at = lineEnd - body.length;
    return at >= cursor && source.startsWith(body, at)
      ? { lead, sourceOffset: at }
      : null;
  }
  // The last line sits after the same prefix as the line before it — or,
  // failing that, wherever its body first appears on the line.
  let at = cursor + prefix;
  if (!source.startsWith(body, at)) {
    at = source.indexOf(body, cursor);
    if (at === -1 || at > lineEnd) return null;
  }
  return { lead, sourceOffset: at };
}

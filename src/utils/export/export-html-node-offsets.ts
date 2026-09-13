// issue 631 — offsets in an html node's text → offsets in the markdown source.
//
// The parser hands an html node's text with the container prefix of every
// continuation line (`> `, list indentation) removed, and a tab that ends a
// prefix expanded to spaces, so an offset found in that text (a tag the
// export will rewrite, export-html-fragment.ts) cannot be spliced into the
// source as it is. This mapper aligns the text's lines with the source's and
// gives up rather than guess when they do not match.

/** A line terminator as the parser reads it (global: searched from `lastIndex`). */
export const LINE_END = /\r\n|\r|\n/g;

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
  // Lines end in LF, CRLF or a lone CR — the parser reads all three, and
  // keeps each as written, so the same terminator is looked for in the source.
  const lines = value.split(LINE_END);
  const valueStarts: number[] = [];
  const sourceStarts: number[] = [];
  let valueAt = 0;
  let cursor = startOffset; // where the current source line begins
  let prefix = 0; // container prefix length of the previous line
  for (let k = 0; k < lines.length; k += 1) {
    const line = lines[k];
    LINE_END.lastIndex = cursor;
    const terminator = LINE_END.exec(source);
    const lineEnd = terminator === null ? source.length : terminator.index;
    const delimiter = terminator === null ? 1 : terminator[0].length;
    // The parser expands a leading tab to spaces, so a continuation line of
    // the text may begin with more blanks than its source line: align on the
    // line's first non-blank character and let the blanks before it map to
    // that same spot (no tag starts or ends inside them).
    const lead = /^[ \t]*/.exec(line)![0].length;
    const body = line.slice(lead);
    let at: number;
    if (k === 0) {
      // The parser expands a tab that ends the container prefix into spaces
      // at the head of the text (`>\t<img` → `  <img`) while `start.offset`
      // already sits past the tab: align the first line on its first
      // non-blank character as well, and let the synthesised blanks map to
      // that same spot.
      at = cursor;
      if (!source.startsWith(line, cursor)) {
        if (!source.startsWith(body, cursor)) return null;
        valueStarts.push(lead);
        sourceStarts.push(at);
        valueAt += line.length + delimiter;
        cursor = lineEnd + delimiter;
        continue;
      }
    } else if (k < lines.length - 1) {
      at = lineEnd - body.length;
      if (at < cursor || !source.startsWith(body, at)) return null;
      prefix = at - cursor;
    } else {
      at = cursor + prefix;
      if (!source.startsWith(body, at)) {
        at = source.indexOf(body, cursor);
        if (at === -1 || at > lineEnd) return null;
      }
    }
    valueStarts.push(valueAt + (k === 0 ? 0 : lead));
    sourceStarts.push(at);
    valueAt += line.length + delimiter;
    cursor = lineEnd + delimiter;
  }
  return (offset: number): number => {
    let k = valueStarts.length - 1;
    while (k > 0 && valueStarts[k] > offset) k -= 1;
    return sourceStarts[k] + Math.max(0, offset - valueStarts[k]);
  };
}

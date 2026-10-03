// §298 — cursor-line column primitives (issue 372 split).
//
// 줄(segment) 스팬과 grapheme 단위 칼럼의 공용 프리미티브. motions(수직
// 워크)와 code-block-landing(코드블록 착지)이 둘 다 쓰므로, 둘 사이의
// 순환을 막기 위해 제3의 leaf로 산다 — 이 파일은 어댑터 형제 모듈을
// import하지 않는다 (line-units와 PM 타입만).

import type { EditorState } from "@tiptap/pm/state";

import { splitSegments } from "./line-units";

export interface CursorLine {
  end: number;
  start: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

/** The hard-break segment (or whole-textblock span) holding `pos`; null on
 *  an atom boundary. */
export function segmentSpanAt(
  state: EditorState,
  pos: number,
): null | { from: number; to: number } {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const textblockPos = $pos.before($pos.depth);
  const segments = splitSegments($pos.parent, textblockPos);
  return (
    segments.find((s) => pos >= s.from && pos <= s.to) ??
    segments[segments.length - 1]
  );
}

/** The current line's span for column math: a hard-break segment (works
 *  inside table cells too) or an atom boundary. */
export function lineSpanAt(state: EditorState, pos: number): CursorLine {
  const span = segmentSpanAt(state, pos);
  return span ? { end: span.to, start: span.from } : { end: pos, start: pos };
}

/** The first cursor unit of `line` that is not blank — a grapheme with a
 *  non-whitespace character, or any non-text inline node (a wikilink or tag
 *  is a unit, never a blank). null when the line is blank or empty. One
 *  traversal (forEachLineUnit): a per-unit textBetween restarts the range
 *  walk at the first child each time, quadratic over a line split into many
 *  marked text nodes. */
export function firstNonBlankUnit(
  state: EditorState,
  line: CursorLine,
): null | number {
  let found: null | number = null;
  forEachLineUnit(state, line, (start, text) => {
    if (text !== null && !/\S/.test(text)) return true;
    found = start;
    return false;
  });
  return found;
}

/**
 * Visit every cursor unit of `line` in order, in ONE traversal: `text` is the
 * unit's grapheme for a text unit, null for a non-text inline node. Return
 * false from `visit` to stop. This is THE definition of a cursor unit — each
 * TEXT NODE is segmented independently, and every non-text inline child is
 * exactly one unit, never descended into. Whole-line segmentation JOINed
 * clusters across mark boundaries and after atom placeholders, diverging
 * from the node-local §6 units (review S3-R6); descending into an inline
 * atom's content made j landings that h/l could not leave (review S3-R7) —
 * nextUnitBoundary skips such a node whole, leaf or not.
 */
export function forEachLineUnit(
  state: EditorState,
  line: CursorLine,
  visit: (start: number, text: null | string) => boolean,
): void {
  if (line.end <= line.start) return;
  let stopped = false;
  state.doc.nodesBetween(line.start, line.end, (node, pos) => {
    if (stopped) return false;
    if (node.isText) {
      const from = Math.max(line.start, pos);
      const to = Math.min(line.end, pos + node.nodeSize);
      const text = (node.text ?? "").slice(from - pos, to - pos);
      let offset = 0;
      for (const seg of graphemeSegmenter.segment(text)) {
        if (!visit(from + offset, seg.segment)) {
          stopped = true;
          break;
        }
        offset += seg.segment.length;
      }
      return false;
    }
    if (node.isInline) {
      if (pos >= line.start && pos < line.end && !visit(pos, null)) {
        stopped = true;
      }
      return false;
    }
    return true; // the textblock container — descend
  });
}

/** Absolute start positions of every cursor unit in a line, one line-local
 *  pass (the unit model is forEachLineUnit's). */
export function lineUnitStarts(state: EditorState, line: CursorLine): number[] {
  const starts: number[] = [];
  forEachLineUnit(state, line, (start) => {
    starts.push(start);
    return true;
  });
  return starts;
}

/** The unit column of `pos` on its own cursor line — the goal column j/k
 *  start from when none is remembered (issue 776). */
export function columnAt(state: EditorState, pos: number): number {
  return columnOf(lineUnitStarts(state, lineSpanAt(state, pos)), pos);
}

/** Units strictly BELOW pos — matching the old walking count: a cursor ON
 *  a unit start is at that unit's index, and the terminal boundary (an insert
 *  caret at the line end; normal mode clamps off it — normal-cursor.ts)
 *  counts the FULL line, not the last index
 *  (review S3-R6). */
export function columnOf(starts: number[], pos: number): number {
  let column = 0;
  for (const start of starts) {
    if (start < pos) column++;
    else break;
  }
  return column;
}

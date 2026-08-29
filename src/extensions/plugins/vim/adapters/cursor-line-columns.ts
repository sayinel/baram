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

/** Absolute start positions of every cursor unit in a line, one line-local
 *  pass. Each TEXT NODE is segmented independently and every non-text
 *  inline leaf contributes exactly one start — whole-line segmentation
 *  JOINed clusters across mark boundaries and after atom placeholders,
 *  diverging from the node-local §6 units (review S3-R6). */
export function lineUnitStarts(state: EditorState, line: CursorLine): number[] {
  if (line.end <= line.start) return [];
  const starts: number[] = [];
  state.doc.nodesBetween(line.start, line.end, (node, pos) => {
    if (node.isText) {
      const from = Math.max(line.start, pos);
      const to = Math.min(line.end, pos + node.nodeSize);
      const text = (node.text ?? "").slice(from - pos, to - pos);
      let offset = 0;
      for (const seg of graphemeSegmenter.segment(text)) {
        starts.push(from + offset);
        offset += seg.segment.length;
      }
      return false;
    }
    if (node.isInline) {
      // ANY non-text inline child is one unit — nextUnitBoundary skips it
      // whole, leaf or not; descending into an inline atom's content made
      // j landings that h/l could not leave (review S3-R7).
      if (pos >= line.start && pos < line.end) starts.push(pos);
      return false;
    }
    return true; // the textblock container — descend
  });
  return starts;
}

/** Units strictly BELOW pos — matching the old walking count: a cursor ON
 *  a unit start is at that unit's index, and the terminal boundary (insert
 *  Esc keeps the head there) counts the FULL line, not the last index
 *  (review S3-R6). */
export function columnOf(starts: number[], pos: number): number {
  let column = 0;
  for (const start of starts) {
    if (start < pos) column++;
    else break;
  }
  return column;
}

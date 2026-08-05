// §298 Vim Phase 1 — cursor units (design §6).
//
// A vim "character" is a grapheme cluster (조합 한글, emoji with modifiers),
// and an inline atom counts as exactly one unit. Segmentation is node-local:
// a cluster split across differently-marked text nodes would be treated as
// two units — accepted for Phase 1 (marks do not split clusters in practice).

import type { EditorState } from "@tiptap/pm/state";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Grapheme starts of the LAST segmented string, plus its length as the final
 * boundary. Counted motions walk the same text node up to MAX_COUNT (9999)
 * times, and segmenting (or even slicing) the prefix per step made `9999h`
 * on a long line quadratic — seconds of frozen renderer on a crafted
 * 100k-character line (dedicated security review). One pass per string,
 * then a binary search per step.
 *
 * Keyed by string VALUE, so an edit (a different string) misses and two
 * nodes with identical text share correctly — no invalidation needed.
 */
let indexedText: null | string = null;
let indexedStarts: number[] = [];

/**
 * The position one cursor unit to the right of `pos`, or `pos` itself at the
 * end of the textblock. Positions outside a textblock stay put.
 */
export function nextUnitBoundary(state: EditorState, pos: number): number {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return pos;

  const offset = $pos.parentOffset;
  if (offset >= $pos.parent.content.size) return pos;

  const child = $pos.parent.childAfter(offset);
  if (!child.node) return pos;

  if (!child.node.isText) {
    // Inline atom — one unit (§6).
    return pos + child.node.nodeSize;
  }

  const text = child.node.text ?? "";
  const inNode = offset - child.offset;
  const next = boundaryAbove(graphemeStarts(text), inNode);
  return next <= inNode ? pos : pos + (next - inNode);
}

/**
 * The position one cursor unit to the LEFT of `pos`, or `pos` itself at the
 * start of the textblock. Mirror of nextUnitBoundary: one grapheme cluster,
 * or one inline atom.
 */
export function prevUnitBoundary(state: EditorState, pos: number): number {
  const $pos = state.doc.resolve(pos);
  if (!$pos.parent.isTextblock) return pos;

  const offset = $pos.parentOffset;
  if (offset === 0) return pos;

  const child = $pos.parent.childBefore(offset);
  if (!child.node) return pos;

  if (!child.node.isText) {
    return pos - child.node.nodeSize; // inline atom — one unit (§6)
  }

  const text = child.node.text ?? "";
  const inNode = offset - child.offset;
  const prev = boundaryBelow(graphemeStarts(text), inNode);
  return prev >= inNode ? pos : pos - (inNode - prev);
}

/** The first boundary strictly above `offset` (binary search). */
function boundaryAbove(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] > offset) hi = mid;
    else lo = mid + 1;
  }
  return starts[lo];
}

/** Index of the last boundary strictly below `offset` (binary search). */
function boundaryBelow(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] < offset) lo = mid;
    else hi = mid - 1;
  }
  return starts[lo];
}

function graphemeStarts(text: string): number[] {
  if (indexedText === text) return indexedStarts;
  const starts: number[] = [];
  for (const seg of segmenter.segment(text)) starts.push(seg.index);
  starts.push(text.length);
  indexedText = text;
  indexedStarts = starts;
  return starts;
}

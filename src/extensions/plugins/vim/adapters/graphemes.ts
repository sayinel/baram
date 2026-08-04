// §298 Vim Phase 1 — cursor units (design §6).
//
// A vim "character" is a grapheme cluster (조합 한글, emoji with modifiers),
// and an inline atom counts as exactly one unit. Segmentation is node-local:
// a cluster split across differently-marked text nodes would be treated as
// two units — accepted for Phase 1 (marks do not split clusters in practice).

import type { EditorState } from "@tiptap/pm/state";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

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
  const first = segmenter.segment(text.slice(inNode))[Symbol.iterator]().next();
  return first.done ? pos : pos + first.value.segment.length;
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
  let last = 0;
  for (const seg of segmenter.segment(text.slice(0, inNode))) {
    last = seg.segment.length;
  }
  return last === 0 ? pos : pos - last;
}

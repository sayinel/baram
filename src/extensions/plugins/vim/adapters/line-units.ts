// §298 Vim Phase 1 — "what is a line?" (design §9).
//
// P1 says a vim line is a MARKDOWN logical line, which in a WYSIWYG tree is
// three different things depending on where the cursor sits. The dispatch
// order is fixed and load-bearing (§9):
//
//     tableRow → hardBreakSegment → structural
//
// Segments never reach the container rules: a `> a⏎b` blockquote holding one
// paragraph must lose only the segment, and the container rule applies later,
// when a structural unit finally consumes the container's last child.
//
// This module only IDENTIFIES the unit and the range an operator should act
// on. Building transactions is the operations adapter's job — keeping the two
// apart is what let spike #7 prove the transactions independently.

import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

/** Containers whose LAST remaining child cannot be removed on its own: in
 *  markdown, deleting the final `> ` line deletes the quote itself. */
const SOLE_CHILD_CONTAINERS = new Set([
  "blockquote",
  "callout",
  "footnoteDefinition",
]);

/** A `toggle`'s first child is required BY POSITION (content is
 *  `(paragraph | heading) block*`, confirmed by spike #7). Deleting it would
 *  silently promote a body block into the summary, so `dd` refuses. */
const POSITIONAL_FIRST_CHILD = new Set(["toggle"]);

export type LineUnit =
  | {
      /** Non-null when the item holds nested lists that must be lifted into
       *  the parent list (spike #7: one replaceWith does it). */
      itemPos: number;
      kind: "listItem";
      nestedListPositions: number[];
      nodeSize: number;
    }
  | {
      /** Range the operator should remove, already following the §9 rule:
       *  take the FOLLOWING break, or the preceding one when at the end. */
      deleteRange: { from: number; to: number };
      /** Content span of the segment itself, without either break. */
      from: number;
      kind: "hardBreakSegment";
      textblockPos: number;
      to: number;
    }
  | {
      /** The container to remove instead, when this block is its only child. */
      blockPos: number;
      containerPos: null | number;
      kind: "structural";
      nodeSize: number;
      /** Schema-position-protected first child — the operator must no-op. */
      protectedFirstChild: boolean;
    }
  | { cellPos: number; kind: "tableRow"; rowPos: number };

/** One segment of a textblock split by hard breaks. */
interface Segment {
  breakAfter: null | number;
  breakBefore: null | number;
  from: number;
  to: number;
}

/**
 * Resolve the vim "line" under a position, in the §9 priority order.
 *
 * Segments deliberately short-circuit before the container and list rules —
 * see the module header for why that ordering is not an implementation
 * detail.
 */
export function resolveLineUnit(state: EditorState, pos: number): LineUnit {
  const $pos = state.doc.resolve(pos);
  return (
    resolveTableRow($pos) ??
    resolveSegment($pos) ??
    resolveListItem($pos) ??
    resolveStructural($pos)
  );
}

/**
 * Split a textblock into hard-break segments.
 *
 * The break atom belongs to the PRECEDING segment (§9 pin), so a segment's
 * `to` is the break's position — which also makes "cursor sitting on a break"
 * resolve to the segment before it, as the pin requires. Consecutive breaks
 * yield a genuinely empty segment, and that empty segment is a real line: it
 * can be deleted, and yanking it gives an empty line register.
 */
export function splitSegments(node: PMNode, textblockPos: number): Segment[] {
  const inner = textblockPos + 1;
  const segments: Segment[] = [];
  let from = inner;
  let breakBefore: null | number = null;

  node.forEach((child, offset) => {
    if (child.type.name !== "hardBreak") return;
    const breakPos = inner + offset;
    segments.push({ breakAfter: breakPos, breakBefore, from, to: breakPos });
    from = breakPos + child.nodeSize;
    breakBefore = breakPos;
  });

  segments.push({
    breakAfter: null,
    breakBefore,
    from,
    to: inner + node.content.size,
  });
  return segments;
}

function findAncestor(
  $pos: ResolvedPos,
  typeName: string,
): null | { depth: number; node: PMNode } {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === typeName) return { depth, node };
  }
  return null;
}

function resolveListItem($pos: ResolvedPos): LineUnit | null {
  const item = findAncestor($pos, "listItem") ?? findAncestor($pos, "taskItem");
  if (!item) return null;

  const nestedListPositions: number[] = [];
  const itemPos = $pos.before(item.depth);
  item.node.forEach((child, offset) => {
    if (child.type.name.endsWith("List")) {
      nestedListPositions.push(itemPos + 1 + offset);
    }
  });

  return {
    itemPos,
    kind: "listItem",
    nestedListPositions,
    nodeSize: item.node.nodeSize,
  };
}

function resolveSegment($pos: ResolvedPos): LineUnit | null {
  const parent = $pos.parent;
  if (!parent.isTextblock) return null;
  const textblockPos = $pos.before($pos.depth);
  const segments = splitSegments(parent, textblockPos);
  if (segments.length < 2) return null; // no hard breaks — not a segment unit

  const pos = $pos.pos;
  const segment =
    segments.find((s) => pos >= s.from && pos <= s.to) ??
    segments[segments.length - 1];

  return {
    deleteRange: segmentDeleteRange(segment),
    from: segment.from,
    kind: "hardBreakSegment",
    textblockPos,
    to: segment.to,
  };
}

function resolveStructural($pos: ResolvedPos): LineUnit {
  // The block the cursor is in, and the node that holds it.
  const depth = $pos.depth === 0 ? 0 : $pos.depth;
  const blockPos = depth === 0 ? $pos.pos : $pos.before(depth);
  const block = depth === 0 ? $pos.parent : $pos.node(depth);
  const parent = depth > 0 ? $pos.node(depth - 1) : null;
  const parentName = parent?.type.name ?? "";

  const isFirstChild = parent ? parent.firstChild === block : false;
  const protectedFirstChild =
    POSITIONAL_FIRST_CHILD.has(parentName) && isFirstChild;

  // A container losing its only child loses itself (§9): the markdown line
  // and the quote/callout are the same thing at that point.
  const containerPos =
    parent && SOLE_CHILD_CONTAINERS.has(parentName) && parent.childCount === 1
      ? $pos.before(depth - 1)
      : null;

  return {
    blockPos,
    containerPos,
    kind: "structural",
    nodeSize: block.nodeSize,
    protectedFirstChild,
  };
}

function resolveTableRow($pos: ResolvedPos): LineUnit | null {
  const row = findAncestor($pos, "tableRow");
  if (!row) return null;
  // The cell is the row's child on the cursor's path; prosemirror-tables wants
  // a cell position to build the CellSelection we normalize to (§9).
  const cell = $pos.node(row.depth + 1);
  if (!cell) return null;
  return {
    cellPos: $pos.before(row.depth + 1),
    kind: "tableRow",
    rowPos: $pos.before(row.depth),
  };
}

/** §9: delete the FOLLOWING break; with none left, take the preceding one. */
function segmentDeleteRange(segment: Segment): { from: number; to: number } {
  if (segment.breakAfter !== null) {
    return { from: segment.from, to: segment.breakAfter + 1 };
  }
  if (segment.breakBefore !== null) {
    return { from: segment.breakBefore, to: segment.to };
  }
  return { from: segment.from, to: segment.to };
}

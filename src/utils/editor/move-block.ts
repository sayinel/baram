import type { Editor } from "@tiptap/core";

/**
 * §4.8 Move the top-level block at `sourcePos` to `targetPos` (a boundary
 * position produced by resolveInsertTarget) in a single transaction.
 * Returns false on no-op: missing node, or a target inside the source's range.
 */
export function moveBlock(
  editor: Editor,
  sourcePos: number,
  targetPos: number,
): boolean {
  const { state } = editor;
  const node = state.doc.nodeAt(sourcePos);
  if (!node) return false;

  const sourceEnd = sourcePos + node.nodeSize;
  // Dropping anywhere inside the block's own span is a no-op.
  if (targetPos >= sourcePos && targetPos <= sourceEnd) return false;

  const tr = state.tr;
  tr.delete(sourcePos, sourceEnd);
  // Map the target across the delete (positions after the cut shift left).
  const insertAt = tr.mapping.map(targetPos);
  tr.insert(insertAt, node);
  editor.view.dispatch(tr);
  return true;
}

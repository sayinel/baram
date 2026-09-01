// Heading & List Folding — foldable range computation

import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

// ── Fold range computation ─────────────────────────────────────────

export interface FoldableItem {
  foldFrom: number;
  foldTo: number;
  kind: "heading" | "listItem";
  node: PmNode;
  pos: number;
}

export function findAllFoldables(doc: PmNode): FoldableItem[] {
  return [...findFoldableHeadings(doc), ...findFoldableListItems(doc)];
}

/**
 * TEST-ONLY: incremented every time findFoldableHeadings runs a full doc walk.
 * Used by unit tests to verify the incremental plugin path skips the walk on
 * pure paragraph edits. Never read in production code.
 */
export let _findFoldableHeadingsCallCount = 0;

/** Reset the test-only call counter. Call from beforeEach in tests. */
export function _resetFindFoldableHeadingsCallCount(): void {
  _findFoldableHeadingsCallCount = 0;
}

/** Find all foldable headings — direct doc children only */
export function findFoldableHeadings(doc: PmNode): FoldableItem[] {
  _findFoldableHeadingsCallCount++;
  const items: FoldableItem[] = [];
  const children: { node: PmNode; pos: number }[] = [];

  doc.forEach((node, offset) => {
    children.push({ pos: offset, node });
  });

  for (let i = 0; i < children.length; i++) {
    const { pos, node } = children[i];
    if (node.type.name !== "heading") continue;

    const level = node.attrs.level as number;
    const foldFrom = pos + node.nodeSize;

    // Find next heading with level <= currentLevel (or doc end)
    let foldTo = doc.content.size;
    for (let j = i + 1; j < children.length; j++) {
      const next = children[j];
      if (
        next.node.type.name === "heading" &&
        (next.node.attrs.level as number) <= level
      ) {
        foldTo = next.pos;
        break;
      }
    }

    // Only foldable if there's content to fold
    if (foldTo > foldFrom) {
      items.push({ pos, node, foldFrom, foldTo, kind: "heading" });
    }
  }

  return items;
}

/** Find all foldable list items — those with nested sub-lists */
export function findFoldableListItems(doc: PmNode): FoldableItem[] {
  const items: FoldableItem[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "listItem") return true;

    let hasNestedList = false;
    let firstChildSize = 0;
    let isFirst = true;

    node.forEach((child) => {
      if (isFirst) {
        firstChildSize = child.nodeSize;
        isFirst = false;
      }
      if (
        child.type.name === "bulletList" ||
        child.type.name === "orderedList" ||
        child.type.name === "taskList"
      ) {
        hasNestedList = true;
      }
    });

    if (hasNestedList && firstChildSize > 0) {
      const foldFrom = pos + 1 + firstChildSize;
      const foldTo = pos + node.nodeSize;
      if (foldTo > foldFrom) {
        items.push({ pos, node, foldFrom, foldTo, kind: "listItem" });
      }
    }

    return true;
  });

  return items;
}

export function getFirstChildSize(node: PmNode): number {
  let size = 0;
  let found = false;
  node.forEach((child) => {
    if (!found) {
      size = child.nodeSize;
      found = true;
    }
  });
  return size;
}

/** Get the fold range for a specific position, or null if not foldable */
export function getFoldRange(
  doc: PmNode,
  pos: number,
): null | { foldFrom: number; foldTo: number } {
  const foldables = findAllFoldables(doc);
  const item = foldables.find((f) => f.pos === pos);
  return item ? { foldFrom: item.foldFrom, foldTo: item.foldTo } : null;
}

/** Get the closest foldable heading/listItem at or containing the cursor */
export function findFoldableAtCursor(state: EditorState): null | number {
  const { $from } = state.selection;
  const foldables = findAllFoldables(state.doc);

  // Check if cursor is directly inside a foldable heading (depth 1 = direct doc child)
  for (let d = $from.depth; d >= 1; d--) {
    const ancestor = $from.node(d);
    const ancestorPos = $from.before(d);
    if (foldables.some((f) => f.pos === ancestorPos)) {
      return ancestorPos;
    }
    // Also check if cursor is in content under a heading
    if (ancestor.type.name === "heading" || ancestor.type.name === "listItem") {
      break;
    }
  }

  // If cursor is in content below a heading, find the heading that owns this region
  const cursorPos = $from.pos;
  for (const item of foldables) {
    if (item.kind === "heading") {
      if (cursorPos >= item.pos && cursorPos < item.foldTo) {
        return item.pos;
      }
    }
  }

  return null;
}

// Drop indicator bar — shows the exact insertion line when dragging images into the editor.
// DOM-managed (not React) to avoid re-renders on every mousemove/over event.
//
// Supports:
// - Inserting between top-level blocks (paragraphs, headings, etc.)
// - Inserting between list items (splits the list on insertion)
// - Fallback DOM rect scanning when posAtCoords fails (native OS drag in WKWebView)
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

export interface InsertTarget {
  pos: number;
  indicatorY: number;
  indicatorLeft: number;
  indicatorWidth: number;
}

let indicatorEl: HTMLDivElement | null = null;

function getIndicator(): HTMLDivElement {
  if (!indicatorEl) {
    indicatorEl = document.createElement("div");
    indicatorEl.className = "drop-indicator-bar";
    // Dot is rendered via ::before pseudo-element in CSS
    document.body.appendChild(indicatorEl);
  }
  return indicatorEl;
}

export function showDropIndicator(target: InsertTarget) {
  const el = getIndicator();
  el.style.top = `${target.indicatorY - 1}px`;
  el.style.left = `${target.indicatorLeft}px`;
  el.style.width = `${target.indicatorWidth}px`;
  el.style.display = "block";
}

export function hideDropIndicator() {
  if (indicatorEl) {
    indicatorEl.style.display = "none";
  }
}

export function removeDropIndicator() {
  if (indicatorEl) {
    indicatorEl.remove();
    indicatorEl = null;
  }
}

// --- List detection ---

function isListNode(node: PMNode): boolean {
  return /^(bulletList|orderedList|taskList)$/.test(node.type.name);
}

// --- Insert helper (handles list splitting) ---

/**
 * Insert a node at the given position, splitting lists if the position
 * is between list items. Returns the position after the inserted node.
 */
export function insertNodeAtPos(editor: Editor, pos: number, node: PMNode): number {
  const $pos = editor.state.doc.resolve(pos);
  const tr = editor.state.tr;

  if ($pos.depth > 0 && isListNode($pos.parent)) {
    // Between list items — split the list, then insert at doc level
    tr.split(pos, 1);
    const mapped = tr.mapping.map(pos);
    tr.insert(mapped, node);
    editor.view.dispatch(tr);
    return mapped + node.nodeSize;
  }

  tr.insert(pos, node);
  editor.view.dispatch(tr);
  return pos + node.nodeSize;
}

// --- Resolution ---

/**
 * Resolve cursor coordinates to the nearest block boundary for image insertion.
 * Supports drilling into lists to find list-item boundaries.
 * Falls back to DOM rect scanning when posAtCoords fails (e.g. during native OS drag).
 */
export function resolveInsertTarget(editor: Editor, x: number, y: number): InsertTarget | null {
  const view = editor.view;
  const doc = editor.state.doc;
  if (doc.childCount === 0) return null;

  // Try ProseMirror's posAtCoords (fast, but may fail during native OS drag)
  const posInfo = view.posAtCoords({ left: x, top: y });

  if (posInfo) {
    const $pos = doc.resolve(posInfo.pos);

    if ($pos.depth >= 1) {
      const blockStart = $pos.before(1);
      const blockNode = doc.nodeAt(blockStart);

      // Drill into list nodes to resolve between list items
      if (blockNode && isListNode(blockNode)) {
        const result = resolveInsideList(view, blockStart, blockNode, y);
        if (result) return result;
      }

      return resolveBlockBoundary(view, blockStart, $pos.after(1), y);
    }

    // depth === 0: between blocks — fall through to block scan
  }

  // Fallback: scan all top-level blocks by DOM bounding rect.
  // This is needed when posAtCoords returns null (native OS drag in WKWebView)
  // or when the resolved position is at doc level (between blocks).
  return scanBlocksByRect(view, doc, y);
}

// --- Internal helpers ---

function resolveBlockBoundary(
  view: EditorView,
  blockStart: number,
  blockEnd: number,
  y: number,
): InsertTarget | null {
  try {
    const dom = view.nodeDOM(blockStart);
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        return { pos: blockStart, indicatorY: rect.top, indicatorLeft: rect.left, indicatorWidth: rect.width };
      }
      return { pos: blockEnd, indicatorY: rect.bottom, indicatorLeft: rect.left, indicatorWidth: rect.width };
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Resolve inside a list node to find the nearest list-item boundary.
 * - Before first item → pos before the entire list (doc level)
 * - Between items → pos between items (inside list, needs split on insert)
 * - After last item → pos after the entire list (doc level)
 */
function resolveInsideList(
  view: EditorView,
  listStart: number,
  listNode: PMNode,
  y: number,
): InsertTarget | null {
  const listEnd = listStart + listNode.nodeSize;
  let offset = listStart + 1; // first position inside list content

  for (let i = 0; i < listNode.childCount; i++) {
    const item = listNode.child(i);
    try {
      const dom = view.nodeDOM(offset);
      if (dom instanceof HTMLElement) {
        const rect = dom.getBoundingClientRect();
        if (y < rect.top + rect.height / 2) {
          if (i === 0) {
            // Before first item → before the entire list at doc level
            return { pos: listStart, indicatorY: rect.top, indicatorLeft: rect.left, indicatorWidth: rect.width };
          }
          // Between items → will need list split on insertion
          return { pos: offset, indicatorY: rect.top, indicatorLeft: rect.left, indicatorWidth: rect.width };
        }
      }
    } catch { /* ignore */ }
    offset += item.nodeSize;
  }

  // After last item → after the entire list at doc level
  if (listNode.childCount > 0) {
    const lastStart = offset - listNode.child(listNode.childCount - 1).nodeSize;
    try {
      const dom = view.nodeDOM(lastStart);
      if (dom instanceof HTMLElement) {
        const rect = dom.getBoundingClientRect();
        return { pos: listEnd, indicatorY: rect.bottom, indicatorLeft: rect.left, indicatorWidth: rect.width };
      }
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * Scan all top-level blocks by DOM rect to find the nearest boundary.
 * Used as fallback when posAtCoords fails or resolves to doc level.
 * Drills into list nodes for list-item granularity.
 */
function scanBlocksByRect(
  view: EditorView,
  doc: PMNode,
  y: number,
): InsertTarget | null {
  let offset = 0;
  let best: InsertTarget | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    try {
      const dom = view.nodeDOM(offset);
      if (dom instanceof HTMLElement) {
        const rect = dom.getBoundingClientRect();

        // Drill into lists when cursor is within the list's rect
        if (isListNode(child) && y >= rect.top && y <= rect.bottom) {
          const result = resolveInsideList(view, offset, child, y);
          if (result) return result;
        }

        // Top boundary
        const topDist = Math.abs(y - rect.top);
        if (topDist < bestDist) {
          bestDist = topDist;
          best = { pos: offset, indicatorY: rect.top, indicatorLeft: rect.left, indicatorWidth: rect.width };
        }

        // Bottom boundary
        const botDist = Math.abs(y - rect.bottom);
        if (botDist < bestDist) {
          bestDist = botDist;
          best = { pos: offset + child.nodeSize, indicatorY: rect.bottom, indicatorLeft: rect.left, indicatorWidth: rect.width };
        }
      }
    } catch { /* ignore */ }
    offset += child.nodeSize;
  }

  return best;
}

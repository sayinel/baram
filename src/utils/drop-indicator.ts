// Drop indicator bar — shows the exact insertion line when dragging images into the editor.
// DOM-managed (not React) to avoid re-renders on every mousemove/over event.
//
// Supports:
// - Inserting between top-level blocks (paragraphs, headings, etc.)
// - Inserting between list items at any nesting depth (splits the list on insertion)
// - Reliable DOM rect scanning (no posAtCoords — avoids WKWebView native drag issues)
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
export function insertNodeAtPos(
  editor: Editor,
  pos: number,
  node: PMNode,
): number {
  const $pos = editor.state.doc.resolve(pos);
  const tr = editor.state.tr;

  if ($pos.depth > 0 && isListNode($pos.parent)) {
    const listNode = $pos.parent;
    const indexInList = $pos.index($pos.depth); // how many items before the split

    // split(pos, 1) inserts 2 tokens (close + open tag) at pos.
    // mapping.map(pos) with forward bias = pos + 2 (inside second list).
    // The position BETWEEN the two lists at parent level = pos + 1.
    tr.split(pos, 1);
    const betweenLists = tr.mapping.map(pos) - 1;
    tr.insert(betweenLists, node);

    // Fix orderedList numbering: set `start` on the second list so it continues
    // e.g. split after item 2 of "1. 2. 3. 4." → first list "1. 2.", second "3. 4."
    if (listNode.type.name === "orderedList") {
      const origStart = (listNode.attrs.start as number) || 1;
      const secondListPos = betweenLists + node.nodeSize;
      try {
        tr.setNodeMarkup(secondListPos, undefined, {
          start: origStart + indexInList,
        });
      } catch {
        /* ignore */
      }
    }

    editor.view.dispatch(tr);
    return betweenLists + node.nodeSize;
  }

  tr.insert(pos, node);
  editor.view.dispatch(tr);
  return pos + node.nodeSize;
}

// --- Resolution ---

/**
 * Resolve cursor coordinates to the nearest block boundary for image insertion.
 * Always uses DOM rect scanning for reliable behavior in all contexts
 * (in-app mouse drag AND native OS drag via Tauri onDragDropEvent).
 *
 * posAtCoords is intentionally NOT used because during native OS drag in WKWebView
 * it can return stale/wrong results, causing the indicator to not show.
 */
export function resolveInsertTarget(
  editor: Editor,
  _x: number,
  y: number,
): InsertTarget | null {
  const view = editor.view;
  const doc = editor.state.doc;
  if (doc.childCount === 0) return null;

  return scanBlocksByRect(view, doc, y);
}

// --- Internal helpers ---

/**
 * Scan all top-level blocks by DOM rect to find the nearest boundary.
 * Drills into list nodes recursively for list-item granularity.
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
          best = {
            pos: offset,
            indicatorY: rect.top,
            indicatorLeft: rect.left,
            indicatorWidth: rect.width,
          };
        }

        // Bottom boundary
        const botDist = Math.abs(y - rect.bottom);
        if (botDist < bestDist) {
          bestDist = botDist;
          best = {
            pos: offset + child.nodeSize,
            indicatorY: rect.bottom,
            indicatorLeft: rect.left,
            indicatorWidth: rect.width,
          };
        }
      }
    } catch {
      /* ignore */
    }
    offset += child.nodeSize;
  }

  return best;
}

/**
 * Resolve inside a list node to find the nearest list-item boundary.
 * Recursively drills into nested lists.
 *
 * Position semantics:
 * - Before first item → pos before the entire list (parent level, no split needed)
 * - Between items → pos between items (inside list, needs split on insert)
 * - After last item → pos after the entire list (parent level, no split needed)
 */
function resolveInsideList(
  view: EditorView,
  listStart: number,
  listNode: PMNode,
  y: number,
): InsertTarget | null {
  const listEnd = listStart + listNode.nodeSize;
  let offset = listStart + 1; // first position inside list content
  let best: InsertTarget | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < listNode.childCount; i++) {
    const item = listNode.child(i);
    try {
      const dom = view.nodeDOM(offset);
      if (dom instanceof HTMLElement) {
        const rect = dom.getBoundingClientRect();

        // If y is within this item, check for nested lists first
        if (y >= rect.top && y <= rect.bottom) {
          const nestedResult = tryNestedLists(view, item, offset, y);
          if (nestedResult) return nestedResult;
        }

        // Top boundary of this item
        const topDist = Math.abs(y - rect.top);
        if (topDist < bestDist) {
          bestDist = topDist;
          // First item's top → before the entire list (parent level)
          // Other items' top → between items (inside list, needs split)
          const pos = i === 0 ? listStart : offset;
          best = {
            pos,
            indicatorY: rect.top,
            indicatorLeft: rect.left,
            indicatorWidth: rect.width,
          };
        }

        // Bottom boundary of every item
        const botDist = Math.abs(y - rect.bottom);
        if (botDist < bestDist) {
          bestDist = botDist;
          // Last item's bottom → after the entire list (parent level)
          // Other items' bottom → same as next item's top (between items, inside list)
          const pos =
            i === listNode.childCount - 1 ? listEnd : offset + item.nodeSize; // next item start
          best = {
            pos,
            indicatorY: rect.bottom,
            indicatorLeft: rect.left,
            indicatorWidth: rect.width,
          };
        }
      }
    } catch {
      /* ignore */
    }
    offset += item.nodeSize;
  }

  return best;
}

/**
 * Check if a listItem contains nested lists and recurse into them.
 * Handles items with multiple nested lists (e.g. paragraph + sublist + paragraph + sublist).
 */
function tryNestedLists(
  view: EditorView,
  listItem: PMNode,
  itemStart: number,
  y: number,
): InsertTarget | null {
  let contentOffset = itemStart + 1; // inside the listItem

  for (let j = 0; j < listItem.childCount; j++) {
    const child = listItem.child(j);
    if (isListNode(child)) {
      try {
        const dom = view.nodeDOM(contentOffset);
        if (dom instanceof HTMLElement) {
          const rect = dom.getBoundingClientRect();
          if (y >= rect.top && y <= rect.bottom) {
            const result = resolveInsideList(view, contentOffset, child, y);
            if (result) return result;
          }
        }
      } catch {
        /* ignore */
      }
    }
    contentOffset += child.nodeSize;
  }

  return null;
}

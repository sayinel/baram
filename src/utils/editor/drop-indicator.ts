// Drop indicator bar — shows the exact insertion line when dragging images into the editor.
// DOM-managed (not React) to avoid re-renders on every mousemove/over event.
//
// Supports:
// - Inserting between top-level blocks (paragraphs, headings, etc.)
// - Inserting between list items at any nesting depth (splits the list on insertion)
// - Reliable DOM rect scanning (no posAtCoords — avoids WKWebView native drag issues)
//
// CSS zoom handling:
// .tiptap may have CSS zoom applied (use-zoom.ts). In WebKit, getBoundingClientRect()
// on children of a zoomed element returns pre-zoom layout coordinates. The indicator
// lives outside the zoom context (.editor-area-scroll), so we scale block coords by
// the zoom factor when positioning, and divide viewport coords by zoom when scanning.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

export interface InsertTarget {
  indicatorLeft: number;
  indicatorWidth: number;
  indicatorY: number;
  pos: number;
}

let indicatorEl: HTMLDivElement | null = null;

// --- Public API ---

export function hideDropIndicator() {
  if (indicatorEl) {
    indicatorEl.style.display = "none";
  }
}

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
    const indexInList = $pos.index($pos.depth);

    tr.split(pos, 1);
    const betweenLists = tr.mapping.map(pos) - 1;
    tr.insert(betweenLists, node);

    // Fix orderedList numbering on the second (split) list
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

export function removeDropIndicator() {
  if (indicatorEl) {
    indicatorEl.remove();
    indicatorEl = null;
  }
}

/**
 * Resolve cursor coordinates to the nearest block boundary for image insertion.
 * Uses DOM rect scanning (not posAtCoords) for reliable behavior in both
 * in-app mouse drag and native OS drag via Tauri onDragDropEvent.
 */
export function resolveInsertTarget(
  editor: Editor,
  _x: number,
  y: number,
): InsertTarget | null {
  const view = editor.view;
  const doc = editor.state.doc;
  if (doc.childCount === 0) return null;

  ensureIndicatorMounted();

  // Convert viewport Y to pre-zoom space for block rect comparison
  const zoom = getZoom(view);
  const adjustedY = zoom !== 1 ? y / zoom : y;

  return scanBlocksByRect(view, doc, adjustedY);
}

/**
 * Position and show the drop indicator bar.
 * Scales pre-zoom block coords by the zoom factor to match the indicator's
 * coordinate system (.editor-area-scroll, which is outside the zoom context).
 */
export function showDropIndicator(target: InsertTarget, view?: EditorView) {
  const el = ensureIndicatorMounted();
  const parent = el.parentElement;
  if (!parent) return;

  const zoom = view ? getZoom(view) : 1;
  const parentRect = parent.getBoundingClientRect();

  el.style.top = `${target.indicatorY * zoom - parentRect.top + parent.scrollTop - 1}px`;
  el.style.left = `${target.indicatorLeft * zoom - parentRect.left + parent.scrollLeft}px`;
  el.style.width = `${target.indicatorWidth * zoom}px`;
  el.style.display = "block";
}

// --- Internal helpers ---

/** Ensure the indicator element exists and is mounted in .editor-area-scroll. */
function ensureIndicatorMounted(): HTMLDivElement {
  if (indicatorEl) {
    if (!indicatorEl.parentElement) {
      const container = document.querySelector(".editor-area-scroll");
      (container || document.body).appendChild(indicatorEl);
    }
    return indicatorEl;
  }
  indicatorEl = document.createElement("div");
  indicatorEl.className = "drop-indicator-bar";
  const container = document.querySelector(".editor-area-scroll");
  (container || document.body).appendChild(indicatorEl);
  return indicatorEl;
}

/** Read the CSS zoom factor from the editor element. */
function getZoom(view: EditorView): number {
  return parseFloat((view.dom as HTMLElement).style.zoom || "") || 1;
}

function isListNode(node: PMNode): boolean {
  return /^(bulletList|orderedList|taskList)$/.test(node.type.name);
}

/**
 * Resolve inside a list node to find the nearest list-item boundary.
 * Position semantics:
 * - Before first item → pos before the entire list (parent level, no split)
 * - Between items → pos between items (inside list, needs split on insert)
 * - After last item → pos after the entire list (parent level, no split)
 */
function resolveInsideList(
  view: EditorView,
  listStart: number,
  listNode: PMNode,
  y: number,
  contentLeft: number,
  contentWidth: number,
): InsertTarget | null {
  const listEnd = listStart + listNode.nodeSize;
  let offset = listStart + 1;
  let best: InsertTarget | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < listNode.childCount; i++) {
    const item = listNode.child(i);
    try {
      const dom = view.nodeDOM(offset);
      if (dom instanceof HTMLElement) {
        const rect = dom.getBoundingClientRect();

        if (y >= rect.top && y <= rect.bottom) {
          const nested = tryNestedLists(
            view,
            item,
            offset,
            y,
            contentLeft,
            contentWidth,
          );
          if (nested) return nested;
        }

        const topDist = Math.abs(y - rect.top);
        if (topDist < bestDist) {
          bestDist = topDist;
          const pos = i === 0 ? listStart : offset;
          best = {
            pos,
            indicatorY: rect.top,
            indicatorLeft: contentLeft,
            indicatorWidth: contentWidth,
          };
        }

        const botDist = Math.abs(y - rect.bottom);
        if (botDist < bestDist) {
          bestDist = botDist;
          const pos =
            i === listNode.childCount - 1 ? listEnd : offset + item.nodeSize;
          best = {
            pos,
            indicatorY: rect.bottom,
            indicatorLeft: contentLeft,
            indicatorWidth: contentWidth,
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
 * Scan all top-level blocks by DOM rect to find the nearest boundary.
 * Drills into list nodes recursively for list-item granularity.
 */
function scanBlocksByRect(
  view: EditorView,
  doc: PMNode,
  y: number,
): InsertTarget | null {
  // Content area bounds from ProseMirror (accounts for padding, zoom, etc.)
  const firstCoords = view.coordsAtPos(0);
  const lastCoords = view.coordsAtPos(doc.content.size);
  const contentLeft = firstCoords.left;
  const contentWidth = lastCoords.right - firstCoords.left;

  let offset = 0;
  let best: InsertTarget | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    try {
      const dom = view.nodeDOM(offset);
      if (dom instanceof HTMLElement) {
        const rect = dom.getBoundingClientRect();

        if (isListNode(child) && y >= rect.top && y <= rect.bottom) {
          const result = resolveInsideList(
            view,
            offset,
            child,
            y,
            contentLeft,
            contentWidth,
          );
          if (result) return result;
        }

        const topDist = Math.abs(y - rect.top);
        if (topDist < bestDist) {
          bestDist = topDist;
          best = {
            pos: offset,
            indicatorY: rect.top,
            indicatorLeft: contentLeft,
            indicatorWidth: contentWidth,
          };
        }

        const botDist = Math.abs(y - rect.bottom);
        if (botDist < bestDist) {
          bestDist = botDist;
          best = {
            pos: offset + child.nodeSize,
            indicatorY: rect.bottom,
            indicatorLeft: contentLeft,
            indicatorWidth: contentWidth,
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

/** Check if a listItem contains nested lists and recurse into them. */
function tryNestedLists(
  view: EditorView,
  listItem: PMNode,
  itemStart: number,
  y: number,
  contentLeft: number,
  contentWidth: number,
): InsertTarget | null {
  let contentOffset = itemStart + 1;

  for (let j = 0; j < listItem.childCount; j++) {
    const child = listItem.child(j);
    if (isListNode(child)) {
      try {
        const dom = view.nodeDOM(contentOffset);
        if (dom instanceof HTMLElement) {
          const rect = dom.getBoundingClientRect();
          if (y >= rect.top && y <= rect.bottom) {
            const result = resolveInsideList(
              view,
              contentOffset,
              child,
              y,
              contentLeft,
              contentWidth,
            );
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

// Drop indicator bar — shows the exact insertion line when dragging images into the editor.
// DOM-managed (not React) to avoid re-renders on every mousemove/over event.
import type { Editor } from "@tiptap/core";

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

/**
 * Resolve cursor coordinates to the nearest top-level block boundary.
 * Returns the ProseMirror insert position + the visual rect for the indicator bar.
 * The indicator rect respects indentation (uses the DOM block element's own bounds).
 */
export function resolveInsertTarget(editor: Editor, x: number, y: number): InsertTarget | null {
  const view = editor.view;
  const doc = editor.state.doc;

  const posInfo = view.posAtCoords({ left: x, top: y });
  if (!posInfo) {
    // Fallback: end of document
    if (doc.childCount === 0) return null;
    const lastPos = doc.content.size;
    const lastChildPos = lastPos - doc.child(doc.childCount - 1).nodeSize;
    try {
      const dom = view.nodeDOM(lastChildPos);
      if (dom instanceof HTMLElement) {
        const rect = dom.getBoundingClientRect();
        return { pos: lastPos, indicatorY: rect.bottom, indicatorLeft: rect.left, indicatorWidth: rect.width };
      }
    } catch { /* ignore */ }
    return null;
  }

  const $pos = doc.resolve(posInfo.pos);

  if ($pos.depth === 0) {
    // Between blocks at doc level — find nearest block boundary
    let offset = 0;
    for (let i = 0; i < doc.childCount; i++) {
      const child = doc.child(i);
      try {
        const dom = view.nodeDOM(offset);
        if (dom instanceof HTMLElement) {
          const rect = dom.getBoundingClientRect();
          if (y < rect.top + rect.height / 2) {
            return { pos: offset, indicatorY: rect.top, indicatorLeft: rect.left, indicatorWidth: rect.width };
          }
        }
      } catch { /* ignore */ }
      offset += child.nodeSize;
    }
    // After last block
    if (doc.childCount > 0) {
      const lastChildPos = offset - doc.child(doc.childCount - 1).nodeSize;
      try {
        const dom = view.nodeDOM(lastChildPos);
        if (dom instanceof HTMLElement) {
          const rect = dom.getBoundingClientRect();
          return { pos: offset, indicatorY: rect.bottom, indicatorLeft: rect.left, indicatorWidth: rect.width };
        }
      } catch { /* ignore */ }
    }
    return null;
  }

  // Inside a block — find the depth-1 ancestor (direct child of doc)
  const blockBefore = $pos.before(1);
  const blockAfter = $pos.after(1);

  try {
    const dom = view.nodeDOM(blockBefore);
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (y < midY) {
        return { pos: blockBefore, indicatorY: rect.top, indicatorLeft: rect.left, indicatorWidth: rect.width };
      } else {
        return { pos: blockAfter, indicatorY: rect.bottom, indicatorLeft: rect.left, indicatorWidth: rect.width };
      }
    }
  } catch { /* ignore */ }

  return null;
}

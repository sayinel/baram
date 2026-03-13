// §5.5 Table virtual scroll performance plugin
import type { EditorView } from "@tiptap/pm/view";

// §5.5 M10 Virtual Scroll — CSS content-visibility for 50+ row tables
// Uses content-visibility: auto for off-screen row layout/paint skipping
// WKWebView (macOS 14+/Tauri 2.0) supported; graceful degradation otherwise
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** Tables with this many rows or more get virtual scroll optimization */
export const VIRTUAL_SCROLL_THRESHOLD = 50;

/** CSS class applied to rows in large tables */
const VSCROLL_CLASS = "baram-vscroll";

/** Intrinsic height hint for content-visibility: auto */
const CONTAIN_INTRINSIC_HEIGHT = "40px";

/**
 * Walk all table DOM elements and apply/remove virtual scroll CSS
 * to rows in tables that exceed the threshold.
 */
export function applyVirtualScrollToLargeTables(view: EditorView): void {
  const tables = view.dom.querySelectorAll("table");
  tables.forEach((table) => {
    const rows = table.querySelectorAll("tr");
    if (shouldApplyVirtualScroll(rows.length)) {
      rows.forEach((tr) => {
        if (!tr.classList.contains(VSCROLL_CLASS)) {
          tr.classList.add(VSCROLL_CLASS);
          tr.style.contentVisibility = "auto";
          tr.style.containIntrinsicHeight = CONTAIN_INTRINSIC_HEIGHT;
        }
      });
    } else {
      // Remove if table shrunk below threshold
      rows.forEach((tr) => {
        if (tr.classList.contains(VSCROLL_CLASS)) {
          tr.classList.remove(VSCROLL_CLASS);
          tr.style.contentVisibility = "";
          tr.style.containIntrinsicHeight = "";
        }
      });
    }
  });
}

/**
 * Determine whether a table should use virtual scroll based on row count.
 */
export function shouldApplyVirtualScroll(rowCount: number): boolean {
  return rowCount >= VIRTUAL_SCROLL_THRESHOLD;
}

/** ProseMirror plugin key for virtual scroll */
export const virtualScrollPluginKey = new PluginKey("tableVirtualScroll");

/**
 * Creates a ProseMirror plugin that applies virtual scroll to large tables.
 * Runs on every view update to handle table insertions/deletions.
 */
export function createVirtualScrollPlugin(): Plugin {
  return new Plugin({
    key: virtualScrollPluginKey,
    view(editorView) {
      // Apply on initial mount
      applyVirtualScrollToLargeTables(editorView);
      return {
        update(view) {
          applyVirtualScrollToLargeTables(view);
        },
      };
    },
  });
}

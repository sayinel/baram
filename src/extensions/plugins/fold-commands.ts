// Heading & List Folding — exported dispatch functions

import type { FoldMeta } from "./fold-state";
import type { EditorView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import { findFoldableAtCursor, getFoldRange } from "./fold-ranges";
import { foldPluginKey } from "./fold-state";

export function dispatchFoldAll(view: EditorView): void {
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "foldAll",
  } as FoldMeta);

  // Move selection to start of doc to avoid being inside folded region
  const $start = view.state.doc.resolve(0);
  tr.setSelection(TextSelection.near($start, 1));

  view.dispatch(tr);
}

export function dispatchRestoreFolds(
  view: EditorView,
  positions: number[],
): void {
  if (positions.length === 0) return;
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "restore",
    positions,
  } as FoldMeta);
  view.dispatch(tr);
}

export function dispatchToggleFold(view: EditorView, pos: number): void {
  const state = foldPluginKey.getState(view.state);
  if (!state) return;

  const isFolding = !state.foldedPositions.has(pos);
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "toggle",
    pos,
  } as FoldMeta);

  // Selection safety: move cursor out of fold range
  if (isFolding) {
    const range = getFoldRange(view.state.doc, pos);
    if (range) {
      const { from } = view.state.selection;
      if (from >= range.foldFrom && from < range.foldTo) {
        const $pos = view.state.doc.resolve(Math.max(0, range.foldFrom - 1));
        tr.setSelection(TextSelection.near($pos));
      }
    }
  }

  view.dispatch(tr);
}

export function dispatchUnfoldAll(view: EditorView): void {
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "unfoldAll",
  } as FoldMeta);
  view.dispatch(tr);
}

/** Toggle fold at the cursor position (for keyboard shortcut) */
export function toggleFoldAtCursor(view: EditorView): boolean {
  const pos = findFoldableAtCursor(view.state);
  if (pos === null) return false;
  dispatchToggleFold(view, pos);
  return true;
}

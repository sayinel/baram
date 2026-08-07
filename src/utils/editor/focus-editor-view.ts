// §298 vim — focusing a ProseMirror view that may be NON-EDITABLE.
//
// Installed prosemirror-view guards its own focus():
//
//   focus() { if (this.editable) focusPreventScroll(this.dom); … }
//
// A vim-modal surface is exactly a non-editable view, so every
// `view.focus()` in the app is a silent no-op while normal/visual mode is
// active: the selection moves, the DOM focus does not, and the next
// keystroke goes wherever focus still is (measured on device — an island
// kept eating keys after the caret had left it). The vim-modal attributes
// supply tabindex="0", so the DOM node is focusable; ask it directly when
// PM declines.
//
// Leaf module: imports the view type only, so NodeViews, toolbars and
// panels can all depend on it.

import type { EditorView } from "@tiptap/pm/view";

/** Focus the view, falling back to its DOM node when PM's gate declines.
 *  `preventScroll` mirrors PM's own focusPreventScroll (installed
 *  prosemirror-view :303) — a bare dom.focus() would scroll the container
 *  under the caret, which PM deliberately avoids. */
export function focusEditorView(view: EditorView): void {
  view.focus();
  if (!view.hasFocus()) view.dom.focus({ preventScroll: true });
}

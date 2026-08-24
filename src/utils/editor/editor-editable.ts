// §298 vim §12-⑩ — app-owned editability signal (design v7.5).
//
// Tiptap has no reliable event for `options.editable` changes:
// `setEditable(value, false)` is silent, and `setOptions({ editable })`
// emits nothing at all. So the app owns the transition — every editability
// flip goes through setEditorEditable, which notifies subscribers itself.
// Leaf module: imports the Editor type only, so NodeViews, hooks, and the
// vim plugin can all depend on it without cycles.

import type { Editor } from "@tiptap/core";

const listeners = new Set<() => void>();

/**
 * The only sanctioned way to change an editor's editability. Direct
 * `setEditable`/`setOptions({ editable })` calls would leave every
 * capability subscriber (use-editor-chrome) holding a stale snapshot.
 */
export function setEditorEditable(editor: Editor, editable: boolean): void {
  editor.setEditable(editable);
  for (const listener of listeners) listener();
}

/** Subscribe to app-owned editability transitions. Returns the unsubscribe. */
export function subscribeEditorEditable(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

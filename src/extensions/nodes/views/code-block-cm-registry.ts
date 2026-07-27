// §298 Phase 1 (§12-4) — per-PMView registry of live CodeMirror code blocks.
//
// Why this exists (design §4, "CM readOnly 동기화"): when vim toggles the PM
// view's editable prop, ProseMirror does NOT call NodeView.update() — only
// doc/attr changes do. So the vim PluginView broadcasts the new editable
// state here, and every live CodeBlockNodeView reconfigures its CM readOnly
// Compartment.
//
// Leaf-module pin (plan review R6): this file must import neither the vim
// module nor concrete NodeView classes — both sides import IT.
import type { EditorView as PMView } from "@tiptap/pm/view";

type EditableSync = (editable: boolean) => void;

const registries = new WeakMap<PMView, Set<EditableSync>>();

/** Push the PM view's editable state to every live code block it hosts. */
export function broadcastCodeBlockEditable(
  view: PMView,
  editable: boolean,
): void {
  const set = registries.get(view);
  if (!set) return;
  for (const sync of set) sync(editable);
}

/**
 * Register a code block's sync callback for its owning PM view.
 * Returns the unregister function — call it in NodeView.destroy().
 */
export function registerCodeBlockEditableSync(
  view: PMView,
  sync: EditableSync,
): () => void {
  let set = registries.get(view);
  if (!set) {
    set = new Set();
    registries.set(view, set);
  }
  set.add(sync);
  return () => {
    set.delete(sync);
  };
}

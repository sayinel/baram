// §298 Phase 1 — insert entry on an atom (design v3 D1).
//
// WHY THIS IS A PREFLIGHT AND NOT A VETO
//
// The core flips the mode to insert before the adapter ever runs, and the
// view's editability is DERIVED from that mode (`editable: (state) =>
// !isModal(read(state))`). So by the time an adapter could refuse, the view
// is already editable — and if a NodeSelection is still live, ProseMirror
// replaces the selected node with the next character typed. A math block was
// destroyed exactly this way in the repository's own README.
//
// The existing rollback for change commands ("A refused CHANGE must not leave
// the editor in insert") is the same problem patched after the fact; it opens
// an editable window and closes it. For atoms that window is the defect, so
// the decision has to happen BEFORE the core state is dispatched.
//
// Inline and block atoms differ, and conflating them was a review finding:
// an inline atom lives inside a textblock, so the positions either side of it
// are valid text positions and `i`/`a` mean something exact. A block atom has
// no such neighbour — `Selection.near` would teleport the caret into the
// previous paragraph, which reads as a bug — so entry belongs to its editing
// island, or nowhere.

import type { InsertAnchor } from "../core/types";
import type { EditorState, Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { NodeSelection, TextSelection } from "@tiptap/pm/state";

/**
 * What the plugin should do with an insert command.
 *
 * - `island` — hand keys to the block's editing island; stay in normal mode
 * - `caret` — place this caret, then enter insert (inline atoms)
 * - `ordinary` — not an atom; take the usual path
 * - `refuse` — nothing can accept the keys; consume and stay in normal
 */
export type AtomInsertPlan =
  | { enter: () => void; kind: "island" }
  | { kind: "caret"; selection: Selection }
  | { kind: "ordinary" }
  | { kind: "refuse" };

/**
 * Decide how `i`/`a`/`I`/`A` should behave at the current selection.
 *
 * Pure with respect to the document: it only reads state and, for the island
 * case, returns a thunk the caller invokes. Cost on the ordinary path is one
 * instanceof check, so plain typing pays nothing.
 */
export function planAtomInsert(
  view: EditorView,
  at: InsertAnchor,
): AtomInsertPlan {
  const state = view.state;
  const selection = state.selection;
  if (!(selection instanceof NodeSelection)) return { kind: "ordinary" };

  const node = selection.node;

  if (node.isInline) {
    return { kind: "caret", selection: inlineCaret(state, selection, at) };
  }

  const enter = islandEntry(view, selection.from);
  return enter ? { enter, kind: "island" } : { kind: "refuse" };
}

/**
 * Where the caret goes for an inline atom.
 *
 * `i`/`a` are positional in vim — before and after the thing under the
 * cursor — and for an inline atom those are exact document positions.
 * `I`/`A` are line-relative, so they resolve against the enclosing
 * textblock rather than the atom.
 */
function inlineCaret(
  state: EditorState,
  selection: NodeSelection,
  at: InsertAnchor,
): Selection {
  const from = selection.from;
  const to = selection.to;
  const $from = state.doc.resolve(from);

  switch (at) {
    case "afterCursor":
      return TextSelection.create(state.doc, to);
    case "atCursor":
      return TextSelection.create(state.doc, from);
    case "lineEnd":
      return TextSelection.create(state.doc, $from.end($from.depth));
    case "lineStart":
      return TextSelection.create(state.doc, $from.start($from.depth));
  }
}

/**
 * The island that owns keyboard input for the block atom at `pos`, if any.
 *
 * Scoped to the selected node's own DOM — a document-wide query could focus
 * a different block's island. The returned thunk only asks for focus; it does
 * NOT report success, because several NodeViews mount their input
 * asynchronously (BlockEmbed waits for content, then React state, then a
 * timer). Focus confirmation arrives out of band as the `focusin` that drives
 * suspension, which is why the caller must keep the view non-editable rather
 * than assume the handoff worked. Fail-closed: no island, no insert.
 */
function islandEntry(view: EditorView, pos: number): (() => void) | null {
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;

  // A NodeView may declare the whole block as an input island (the marker) or
  // expose a focusable control inside it. Prefer an actually focusable
  // element; the marker alone can sit on a plain div.
  const focusable = dom.querySelector<HTMLElement>(
    "textarea, input, select, [contenteditable='true'], .cm-content",
  );
  if (focusable) return () => focusable.focus();

  // Some NodeViews only render their editor once selected, so the control may
  // not exist yet. The marker tells us one is coming; ask the wrapper to take
  // focus so the NodeView's own selection effect can run.
  if (dom.hasAttribute("data-vim-suspend") && dom.tabIndex >= 0) {
    return () => dom.focus();
  }
  return null;
}

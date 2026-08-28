// issue 477 — PM insert-mode arrow entry into code-block islands.
//
// PM insert mode is an EDITABLE view, but a vim-enabled island keeps its 3v
// editing-host barrier (contenteditable=false) even then — a non-editable
// subtree inside an editable document. WebKit's caret motion cannot step
// into such a subtree, so a plain arrow next to a code block skipped the
// whole island (device log: sel 5→61 in one keystroke). The explicit entry
// channel that normal mode already uses carries the caret in instead,
// landing in INSERT — an arrow while editing means "keep editing".
//
// The caller (vim handleKeyDown, insert branch) owns the mode/modifier/
// transient gates; this module owns adjacency, the layout edge gate, and
// the landing.

import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { Selection, TextSelection } from "@tiptap/pm/state";

import { enterCodeBlockSelection } from "../../../nodes/views/code-block-cm-registry";
import { insertEntryTarget } from "./code-block-landing";

/**
 * True when the arrow was fully handled: the PM selection was dispatched to
 * the directional landing line and the island handoff was requested with
 * insert intent. A cold or still-loading island delivers the insert on
 * attach through the registrant's memo — the event is consumed either way,
 * because the caret is already visibly inside the block.
 */
export function insertArrowEntry(view: EditorView, dir: -1 | 1): boolean {
  const state = view.state;
  const sel = state.selection;
  if (!sel.empty || !(sel instanceof TextSelection)) return false;
  const $head = sel.$head;
  if (!$head.parent.isTextblock) return false;
  if ($head.parent.type.name === "codeBlock") return false; // already inside
  // Structural adjacency FIRST — endOfTextblock forces a layout measure,
  // needless work on every mid-document arrow (adversarial review).
  const inside = adjacentCodeBlockInside(state, dir);
  if (inside === null) return false;
  // Layout gate: only a caret on the block-facing edge line enters.
  // endOfTextblock is PM's own bidi- and soft-wrap-aware arrow predicate.
  if (!view.endOfTextblock(dir > 0 ? "down" : "up")) return false;
  const target = insertEntryTarget(
    state,
    $head.pos,
    inside,
    dir > 0 ? "first" : "last",
  );
  if (target === null) return false; // journal-* widget — no CM caret
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)));
  enterCodeBlockSelection(view, { vimMode: "insert" });
  return true;
}

/** Content start of the directionally adjacent code block, or null. The
 *  Selection.near probe from just outside the caret's textblock handles
 *  nesting the same way PM's own arrow fallback would (the canonical
 *  prosemirror CodeMirror-example adjacency shape). */
function adjacentCodeBlockInside(
  state: EditorState,
  dir: -1 | 1,
): null | number {
  const $head = (state.selection as TextSelection).$head;
  const probe = dir > 0 ? $head.after() : $head.before();
  const next = Selection.near(state.doc.resolve(probe), dir);
  if (!(next instanceof TextSelection)) return null;
  const $n = next.$head;
  if ($n.parent.type.name !== "codeBlock") return null;
  return $n.pos - $n.parentOffset;
}

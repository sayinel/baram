// §5.4 code block → ProseMirror escape helpers — extracted from the NodeView
// so initCM reads as lifecycle. Both are needed by the boundary keymap and
// by vim's island boundary handler, so they are built once per CM instance.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView as PMView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

import { focusEditorView } from "../../../utils/editor/focus-editor-view";
import { type VimMode, vimPluginKey } from "../../plugins/vim/vim-keys";
import { enterCodeBlockSelection } from "./code-block-cm-registry";

export interface CodeBlockEscape {
  /** Focus PM even while non-editable (vim modal). */
  focusPM(): void;
  /** Leave the block toward the PM neighbour (-1 up, 1 down). issue 478 —
   *  `pmMode` rides the SAME transaction as the selection move (or the
   *  no-neighbour paragraph insertion): the mode follows the cursor out,
   *  atomically and success-coupled — a getPos-less no-op escape must not
   *  change the outer mode. */
  maybeEscape(dir: -1 | 1, pmMode?: null | VimMode): void;
}

export function createCodeBlockEscape(
  view: PMView,
  getPos: () => number | undefined,
  node: () => PMNode,
): CodeBlockEscape {
  const focusPM = () => {
    focusEditorView(view);
  };

  // Helper to exit CodeMirror → ProseMirror with proper direction bias.
  // dir: -1 = up/backward, 1 = down/forward
  const maybeEscape = (dir: -1 | 1, pmMode: null | VimMode = null) => {
    const pos = getPos();
    if (typeof pos !== "number") return;
    const stampMode = (tr: import("@tiptap/pm/state").Transaction) => {
      if (pmMode) {
        tr.setMeta(vimPluginKey, {
          boundary: true,
          mode: pmMode,
          type: "setMode",
        });
      }
      return tr;
    };
    const targetPos = pos + (dir < 0 ? 0 : node().nodeSize);
    const selection = TextSelection.near(
      view.state.doc.resolve(targetPos),
      dir,
    );
    // Check if selection resolved back inside this code block
    const selInside =
      selection.from > pos && selection.from < pos + node().nodeSize;
    if (selInside) {
      // No valid position in escape direction — insert a new paragraph
      const insertPos = dir < 0 ? pos : pos + node().nodeSize;
      const paragraph = view.state.schema.nodes.paragraph.create();
      const tr = view.state.tr.insert(insertPos, paragraph);
      // After insert, positions shift — set selection into the new paragraph
      const newCursorPos = dir < 0 ? insertPos + 1 : insertPos + 1;
      tr.setSelection(TextSelection.near(tr.doc.resolve(newCursorPos), dir));
      view.dispatch(stampMode(tr.scrollIntoView()));
      focusPM();
      return;
    }
    const tr = view.state.tr.setSelection(selection).scrollIntoView();
    view.dispatch(stampMode(tr));
    // Adjacent islands (review): at an A→B code-block boundary the
    // selection resolves INTO B, and while vim is on the selectionToDOM
    // descent cannot be relied on to deliver it — the same gap the explicit
    // entry channel exists for. Hand off to B, carrying the insert intent
    // on an insert exit; PM focus stays the fallback for a cold island or
    // a widget block with no registrant. With vim off the native descent
    // already handles adjacency — unchanged.
    if (pmMode) {
      const entered = enterCodeBlockSelection(
        view,
        pmMode === "insert" ? { vimMode: "insert" } : undefined,
      );
      if (entered) return;
    }
    focusPM();
  };

  return { focusPM, maybeEscape };
}

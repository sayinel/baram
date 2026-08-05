// §5.4 code block → ProseMirror escape helpers — extracted from the NodeView
// so initCM reads as lifecycle. Both are needed by the boundary keymap and
// by vim's island boundary handler, so they are built once per CM instance.

import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView as PMView } from "@tiptap/pm/view";

import { TextSelection } from "@tiptap/pm/state";

export interface CodeBlockEscape {
  /** Focus PM even while non-editable (vim modal). */
  focusPM(): void;
  /** Leave the block toward the PM neighbour (-1 up, 1 down). */
  maybeEscape(dir: -1 | 1): void;
}

export function createCodeBlockEscape(
  view: PMView,
  getPos: () => number | undefined,
  node: () => PMNode,
): CodeBlockEscape {
  const focusPM = () => {
    view.focus();
    if (!view.hasFocus()) view.dom.focus();
  };

  // Helper to exit CodeMirror → ProseMirror with proper direction bias.
  // dir: -1 = up/backward, 1 = down/forward
  const maybeEscape = (dir: -1 | 1) => {
    const pos = getPos();
    if (typeof pos !== "number") return;
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
      view.dispatch(tr.scrollIntoView());
      focusPM();
      return;
    }
    const tr = view.state.tr.setSelection(selection).scrollIntoView();
    view.dispatch(tr);
    focusPM();
  };

  return { focusPM, maybeEscape };
}

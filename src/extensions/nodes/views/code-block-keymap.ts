// §5.4 code block ↔ ProseMirror keymap — extracted from the NodeView so
// initCM stays readable (file/function size guideline). Pure builder: every
// document interaction arrives as a callback, so the keymap itself holds no
// state and can be pinned in isolation.

import type { Extension } from "@codemirror/state";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView as PMView } from "@tiptap/pm/view";

import { keymap } from "@codemirror/view";
import { redo, undo } from "@tiptap/pm/history";
import { TextSelection } from "@tiptap/pm/state";

export interface CodeBlockKeymapDeps {
  /** Leave the block toward the PM neighbour (-1 up, 1 down). */
  escape(dir: -1 | 1): void;
  /** Focus PM even while non-editable — view.focus() is editable-gated. */
  focusPM(): void;
  getPos(): number | undefined;
  /** issue 478 — the empty-block Backspace conversion is a boundary
   *  crossing too: the owner stamps the outgoing mode onto the SAME
   *  replacement transaction (the keymap itself stays vim-agnostic). */
  stampExitMode?(tr: Transaction): void;
  view: PMView;
}

/** Arrow/Escape boundary crossing, empty-block conversion, PM undo/redo. */
export function buildCodeBlockKeymap(deps: CodeBlockKeymapDeps): Extension {
  return keymap.of([
    {
      key: "ArrowUp",
      run: (cmv) => {
        const { head } = cmv.state.selection.main;
        const line = cmv.state.doc.lineAt(head);
        if (line.number === 1) {
          deps.escape(-1);
          return true;
        }
        return false;
      },
    },
    {
      key: "ArrowDown",
      run: (cmv) => {
        const { head } = cmv.state.selection.main;
        const line = cmv.state.doc.lineAt(head);
        if (line.number === cmv.state.doc.lines) {
          deps.escape(1);
          return true;
        }
        return false;
      },
    },
    {
      key: "Escape",
      run: () => {
        deps.escape(-1);
        return true;
      },
    },
    {
      key: "Backspace",
      run: (cmv) => {
        const { head } = cmv.state.selection.main;
        if (head === 0 && cmv.state.doc.length === 0) {
          // Empty code block → convert to paragraph
          const pos = deps.getPos();
          if (typeof pos !== "number") return false;
          const pmNode = deps.view.state.doc.nodeAt(pos);
          if (!pmNode) return false;
          const paragraph = deps.view.state.schema.nodes.paragraph.create();
          const tr = deps.view.state.tr.replaceWith(
            pos,
            pos + pmNode.nodeSize,
            paragraph,
          );
          tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
          deps.stampExitMode?.(tr);
          deps.view.dispatch(tr);
          deps.focusPM(); // view.focus() alone is editable-gated (vim modal)
          return true;
        }
        return false;
      },
    },
    {
      key: "Mod-z",
      run: () => {
        undo(deps.view.state, deps.view.dispatch);
        return true;
      },
    },
    {
      key: "Mod-Shift-z",
      run: () => {
        redo(deps.view.state, deps.view.dispatch);
        return true;
      },
    },
    {
      key: "Mod-y",
      run: () => {
        redo(deps.view.state, deps.view.dispatch);
        return true;
      },
    },
  ]);
}

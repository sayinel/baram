// §377 The slash menu's "Symbols & Emoji": open the picker at the caret and
// write what is picked there, as if typed.
//
// The table item's shape (slash-command-items-rich.ts): the picker is an
// unbounded async gap, so it is awaited through `awaitBoundToEditor` (§12-9b),
// which answers null when another document was installed meanwhile.
import type { Editor } from "@tiptap/core";

import { showSymbolPicker } from "../../components/command/show-symbol-picker";
import { useSettingsStore } from "../../stores/settings/store";
import { awaitBoundToEditor } from "../../utils/editor/mutation-tasks";
import { canUseEditorChrome, chainWithVimExternalEdit } from "./vim/vim-keys";

export async function pickSymbolIntoEditor(editor: Editor): Promise<void> {
  const coords = editor.view.coordsAtPos(editor.state.selection.from);
  const char = await awaitBoundToEditor(editor.view, showSymbolPicker(coords));
  // Asked again at commit time: what the slash menu saw is as old as the
  // picker has been open (vim-keys.ts, canUseEditorChrome).
  if (char === null || !canUseEditorChrome(editor)) return;
  const before = editor.state.doc;
  chainWithVimExternalEdit(editor)
    .focus()
    .command(({ tr }) => {
      // No range: this replaces the selection and takes the stored marks, or
      // else the marks at the caret — what typing the character would do
      // (prosemirror-state 1.4.4, Transaction.replaceSelectionWith).
      tr.insertText(char);
      return true;
    })
    .run();
  // Recorded only when the document took it: a filtered transaction writes nothing.
  if (editor.state.doc !== before) {
    useSettingsStore.getState().pushRecentSymbol(char);
  }
}

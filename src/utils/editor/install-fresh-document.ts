// §3.6 Install a whole new document parsed from markdown into a live editor —
// the "fresh" half of the content refresh (`use-editor-effects.ts`), shared with
// the conflict actions that put the file's new text into the tab's live view.
//
// A fresh install starts a new history: undo cannot walk back across another
// party's edit. The caret keeps its offset, clamped to the new document.
import type { Editor } from "@tiptap/core";

import { EditorState, TextSelection } from "@tiptap/pm/state";

import { replaceEditorStateWithVim } from "../../extensions/plugins/vim/replace-editor-state";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";

export function installFreshDocument(editor: Editor, markdown: string): void {
  const newDoc = markdownToProsemirror(markdown, editor.schema);
  const prevPos = editor.state.selection.anchor;
  const selPos = Math.min(prevPos, newDoc.content.size);
  const newState = EditorState.create({
    doc: newDoc,
    selection: TextSelection.near(newDoc.resolve(selPos), -1),
    plugins: editor.state.plugins,
  });
  replaceEditorStateWithVim(editor.view, newState, "fresh-document");
}

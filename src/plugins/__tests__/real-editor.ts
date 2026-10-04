// A real Tiptap Editor for the editor-API tests, with the caret or range placed by `@@`
// markers in the source: one marker is a caret, two are a range. The content goes in and
// the markers are deleted in history-free transactions, so the undo stack starts empty —
// a fixture `setContent` in history would merge with the first edits a test makes (§388
// Task 4 measured `undoDepth` 1 before this) and an undo would take the document with it.
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";

/** The `code` a synchronous call threw with, or `undefined` when it did not throw. */
export function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? "(no code)";
  }
  return undefined;
}

export function realEditor(source: string): {
  editor: Editor;
  from: number;
  to: number;
} {
  const editor = new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
  editor
    .chain()
    .setMeta("addToHistory", false)
    .setContent(markdownToProsemirror(source, editor.schema).toJSON())
    .run();
  const found: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    for (
      let i = node.text!.indexOf("@@");
      i !== -1;
      i = node.text!.indexOf("@@", i + 2)
    ) {
      found.push(pos + i);
    }
  });
  const tr = editor.state.tr.setMeta("addToHistory", false);
  for (const p of [...found].reverse()) tr.delete(p, p + 2);
  const from = found[0] ?? 1;
  const to = found.length > 1 ? found[1] - 2 : from;
  tr.setSelection(TextSelection.create(tr.doc, from, to));
  editor.view.dispatch(tr);
  return { editor, from, to };
}

/** Set a text selection through a dispatched transaction, the way a click or drag does. */
export function select(editor: Editor, from: number, to = from): void {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, to),
    ),
  );
}

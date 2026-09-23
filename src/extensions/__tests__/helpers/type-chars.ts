import type { Editor } from "@tiptap/core";

// §373 Typing one key at a time, the way ProseMirror's DOM input would.
//
// `insertContentAt(…, { applyInputRules: true })` (task-input-rules.test.ts)
// puts the whole string in and runs the rules ONCE, on the text as it ends up.
// Rules that fire on an intermediate state never see it: `<->` becomes `↔`
// only because `<-` first became `←` on the second key, and the em dash rule
// fires on the key AFTER `--`. This helper offers each character to
// `handleTextInput` — the prop ProseMirror calls on a real keystroke — and,
// when no plugin claims it, inserts it the way the default path would.

export function pressBackspace(editor: Editor): boolean {
  return pressKey(editor, "Backspace");
}

export function pressEnter(editor: Editor): boolean {
  return pressKey(editor, "Enter");
}

export function typeChars(editor: Editor, text: string): void {
  for (const ch of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

/**
 * Hands a keydown to the plugin chain, as ProseMirror's keydown handler does.
 * Returns whether any plugin claimed it. An unclaimed Enter or Backspace does
 * nothing here — there is no browser behind jsdom to perform the default.
 */
function pressKey(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent("keydown", { bubbles: true, key });
  return (
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) === true
  );
}

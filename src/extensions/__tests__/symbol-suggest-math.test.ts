import type { Transaction } from "@tiptap/pm/state";

import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { findSuggestionMatch } from "@tiptap/suggestion";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";
import { _resetEmojiCache } from "../plugins/emoji-data";
import { mathEditKey } from "../plugins/math-inline-edit";
import { symbolSuggestPluginKey } from "../plugins/suggestion-keys";
import { SYMBOL_TRIGGER } from "../plugins/symbol-suggest";
import { syntaxRevealKey } from "../plugins/syntax-reveal-state";
import { typeChars } from "./helpers/type-chars";

// §375 The `:` menu must not open in the TeX source of an inline-math edit.
// The suggestion plugin's state is computed before MathInlineEdit's, so
// symbol-suggest.ts derives the edit state itself (`insideMathEdit`). Before
// expecting the suggestion inactive, each case asserts that the edit is active
// and that the library's own match finds `ar` at the caret, so only that check
// can keep it inactive.

let editor: Editor;

function caretAt(pos: number): void {
  const { state } = editor;
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, pos)),
  );
}

function create(content: string): Editor {
  editor = new Editor({ content, extensions: createBaramExtensions() });
  return editor;
}

/** Position of the first inline-math atom. */
function mathAtomPos(): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "mathInline" && found === -1) found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error("no math atom");
  return found;
}

/** What the library's own matcher reads at the caret, before allow/shouldShow. */
function queryAtCaret(): string | undefined {
  return findSuggestionMatch({
    ...SYMBOL_TRIGGER,
    $position: editor.state.selection.$from,
  })?.query;
}

const active = () =>
  (symbolSuggestPluginKey.getState(editor.state) as { active: boolean }).active;

beforeEach(() => {
  _resetEmojiCache();
  useSettingsStore.setState({ locale: "en", symbolSuggest: true });
});

afterEach(() => {
  editor?.destroy();
});

describe("the : menu and an inline-math edit", () => {
  it("stays inactive in the TeX of an inline-math edit, and opens without the edit", () => {
    // `$` opens the edit as `$|$`; the rest is typed between the dollars.
    create("<p></p>");
    typeChars(editor, "$");
    typeChars(editor, " :ar");
    expect(editor.state.doc.textContent).toBe("$ :ar$");
    expect(mathEditKey.getState(editor.state)).toEqual({
      active: true,
      from: 1,
      to: 7,
    });
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(false);

    editor.destroy();
    create("<p>$ :ar$</p>");
    caretAt(6); // between `r` and the closing `$`
    expect(mathEditKey.getState(editor.state)?.active).toBe(false);
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(true);
  });

  it("stays inactive when the key that re-edits a math atom completes a :query", () => {
    // One transaction turns the atom into `$f :a$`, types `r` and activates
    // the edit — the query and the edit arrive together.
    create("<p>x</p>");
    editor.commands.insertContentAt(2, {
      attrs: { formula: "f :a" },
      type: "mathInline",
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 2)),
    );
    const key = new KeyboardEvent("keydown", { bubbles: true, key: "r" });
    editor.view.someProp("handleKeyDown", (f) => f(editor.view, key));
    expect(editor.state.doc.textContent).toBe("x$f :ar$");
    expect(mathEditKey.getState(editor.state)).toEqual({
      active: true,
      from: 2,
      to: 9,
    });
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(false);

    editor.destroy();
    create("<p>x$f :ar$</p>");
    caretAt(8); // between `r` and the closing `$`
    expect(mathEditKey.getState(editor.state)?.active).toBe(false);
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(true);
  });

  it("stays inactive when a click re-edits a math atom and a reveal collapses after it", () => {
    // The click's transaction activates the edit with the caret after `:ar`;
    // moving the caret out of the expanded `**bold**` makes SyntaxReveal
    // append a collapse. The suggestion's last word is on that appended one.
    create("<p><strong>bold</strong> x</p>");
    editor.commands.insertContentAt(7, {
      attrs: { formula: "f :ar" },
      type: "mathInline",
    });
    caretAt(3); // inside `bold`
    expect(syntaxRevealKey.getState(editor.state)?.expanded).toBeTruthy();
    expect(editor.state.doc.textContent).toBe("**bold** x");

    const appended: Transaction[] = [];
    editor.on("transaction", ({ appendedTransactions }) => {
      appended.push(...appendedTransactions);
    });
    const click = new MouseEvent("click", { bubbles: true });
    const pos = mathAtomPos();
    editor.view.someProp("handleClick", (f) => f(editor.view, pos, click));

    expect(appended.length).toBeGreaterThan(0);
    expect(appended.some((tr) => tr.docChanged)).toBe(true);
    expect(editor.state.doc.textContent).toBe("bold x$f :ar$");
    expect(mathEditKey.getState(editor.state)?.active).toBe(true);
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(false);
  });
});

import { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { findSuggestionMatch } from "@tiptap/suggestion";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";
import { _resetEmojiCache, ensureEmojiLoaded } from "../plugins/emoji-data";
import { mathEditKey } from "../plugins/math-inline-edit";
import {
  suggestionPluginKeys,
  symbolSuggestPluginKey,
} from "../plugins/suggestion-keys";
import { insertSymbol, SYMBOL_TRIGGER } from "../plugins/symbol-suggest";
import { typeChars } from "./helpers/type-chars";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  },
});

function match(text: string) {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, text ? [schema.text(text)] : []),
  ]);
  return findSuggestionMatch({
    ...SYMBOL_TRIGGER,
    $position: doc.resolve(text.length + 1),
  });
}

let editor: Editor;

function caretAt(pos: number): void {
  const { state } = editor;
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, pos)),
  );
}

/** Put the caret at the end of the first textblock, through a real transaction. */
function caretAtEnd(): void {
  const { state } = editor;
  let end = 1;
  state.doc.descendants((node, pos) => {
    if (node.isTextblock && end === 1) end = pos + 1 + node.content.size;
    return end === 1;
  });
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, end)),
  );
}

function create(content: string): Editor {
  editor = new Editor({ content, extensions: createBaramExtensions() });
  return editor;
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

describe("SYMBOL_TRIGGER", () => {
  it.each(["10:30", "https://", "due:", "key:: value", "예:", "a: b"])(
    "passes over %j",
    (text) => {
      expect(match(text)).toBeNull();
    },
  );

  it.each([
    [":ar", "ar"],
    ["a :화살", "화살"],
    [":+1", "+1"],
  ])("opens on %j with query %j", (text, query) => {
    expect(match(text)?.query).toBe(query);
  });
});

describe("suggestionPluginKeys", () => {
  it("includes the symbol popup, which the vim Esc arbiter reads", () => {
    expect(suggestionPluginKeys).toContain(symbolSuggestPluginKey);
  });
});

describe("when the suggestion is active", () => {
  it("opens for two characters that match", () => {
    create("<p></p>");
    typeChars(editor, ":ar");
    expect(active()).toBe(true);
  });

  it("stays inactive for one character, so nothing invisible holds Esc", () => {
    create("<p></p>");
    typeChars(editor, ":a");
    expect(active()).toBe(false);
  });

  it("stays inactive when nothing matches", () => {
    create("<p></p>");
    typeChars(editor, ":zzqq");
    expect(active()).toBe(false);
  });

  it("stays inactive with the setting off", () => {
    useSettingsStore.setState({ symbolSuggest: false });
    create("<p></p>");
    typeChars(editor, ":ar");
    expect(active()).toBe(false);
  });

  it("stays inactive inside a code block", () => {
    create("<pre><code>x :ar</code></pre>");
    caretAtEnd();
    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(false);
  });

  // Each code case pairs with a twin that differs only in the code-ness, and
  // first asserts the library's own match finds query `ar` at the caret — so
  // `allow` is the only thing that can keep it inactive.
  it("stays inactive in inline code the caret has revealed, and opens without the code", () => {
    create("<p><code>x :ar!</code></p>");
    caretAt(6); // between `r` and `!`
    // SyntaxReveal expanded the code to literal backticks: no code mark is left.
    expect(editor.state.doc.firstChild?.toJSON().content).toEqual([
      { text: "`x :ar!`", type: "text" },
    ]);
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(false);

    editor.destroy();
    create("<p>x :ar!</p>");
    caretAt(6);
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(true);
  });

  it("stays inactive after an unclosed backtick, and opens once it is closed", () => {
    create("<p></p>");
    typeChars(editor, "`x :ar");
    expect(editor.state.doc.textContent).toBe("`x :ar");
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(false);

    editor.destroy();
    create("<p></p>");
    typeChars(editor, "`x` :ar");
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(true);
  });

  it("stays inactive in code typed with the mark stored (Mod+E), and opens without it", () => {
    // Typing suppresses SyntaxReveal at the caret, so this text keeps its code
    // mark and has no backtick — only the mark check (isCodeAt) sees it.
    create("<p></p>");
    editor.commands.setMark("code");
    typeChars(editor, ":ar");
    const node = editor.state.doc.firstChild?.firstChild;
    expect(node?.text).toBe(":ar");
    expect(node?.marks.map((m) => m.type.name)).toEqual(["code"]);
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(false);

    editor.destroy();
    create("<p></p>");
    typeChars(editor, ":ar");
    expect(queryAtCaret()).toBe("ar");
    expect(active()).toBe(true);
  });

  it("stays inactive right after a mark ends, and opens after a space", () => {
    // The library only sees the text node `:ar`, whose start looks like a line start.
    create("<p><strong>굵게</strong>:ar</p>");
    caretAtEnd();
    expect(active()).toBe(false);

    editor.destroy();
    create("<p><strong>굵게</strong> :ar</p>");
    caretAtEnd();
    expect(active()).toBe(true);
  });

  it("opens right after a hard break, which starts a visual line", () => {
    create("<p>a<br>:ar</p>");
    caretAtEnd();
    expect(active()).toBe(true);
  });

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
});

describe("emoji load", () => {
  it("re-evaluates when the table lands, without another key", async () => {
    create("<p></p>");
    typeChars(editor, ":웃음"); // no symbol has this keyword
    expect(active()).toBe(false);

    await ensureEmojiLoaded();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(active()).toBe(true);
  });
});

describe("insertSymbol", () => {
  it("replaces the :query with the character and leaves the caret after it", () => {
    create("<p>a :ar</p>");
    // The caret is where the suggestion found the query — at range.to.
    // insertText with a range only maps the selection, so this is what
    // puts it after the character.
    caretAtEnd();
    insertSymbol(editor, { from: 3, to: 6 }, "→");
    expect(editor.state.doc.textContent).toBe("a →");
    expect(editor.state.selection.from).toBe(4);
  });

  it("keeps the marks of the :query it replaces", () => {
    create("<p><strong>x :ar</strong></p>");
    insertSymbol(editor, { from: 3, to: 6 }, "→");
    const node = editor.state.doc.firstChild?.firstChild;
    expect(node?.text).toBe("x →");
    expect(node?.marks.map((m) => m.type.name)).toEqual(["bold"]);
  });
});

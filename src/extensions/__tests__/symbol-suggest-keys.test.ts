// §375 Enter and Tab reach the `:` menu through the real plugin chain.
//
// The menu claims them in `SymbolMenuList.onKeyDown`, reached through the
// suggestion plugin's `handleKeyDown`. Every keymap plugin ordered before it
// gets the key first — list items split and sink on Enter and Tab — so this
// sends real keydowns to `view.dom` rather than calling the menu directly.
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onKeyDown = vi.hoisted(() => vi.fn((_event: KeyboardEvent) => true));

// Only the popup renderer is replaced: its `ref` is the menu the suggestion
// plugin hands keys to. NodeViews keep the real module.
vi.mock("@tiptap/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tiptap/react")>()),
  ReactRenderer: class {
    element = document.createElement("div");
    ref = { onKeyDown };
    destroy() {}
    updateProps() {}
  },
}));

import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";
import { symbolSuggestPluginKey } from "../plugins/suggestion-keys";
import { typeChars } from "./helpers/type-chars";

let editor: Editor;

/** Caret at the end of the last textblock. */
function caretAtLastEnd(): void {
  const { state } = editor;
  let end = 1;
  state.doc.descendants((node, pos) => {
    if (node.isTextblock) end = pos + 1 + node.content.size;
  });
  editor.view.dispatch(
    state.tr.setSelection(TextSelection.create(state.doc, end)),
  );
}

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key,
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

async function typeQuery(content: string): Promise<void> {
  editor = new Editor({ content, extensions: createBaramExtensions() });
  caretAtLastEnd();
  typeChars(editor, " :ar");
  // The suggestion view fetches items asynchronously after `onStart`.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const active = () =>
  (symbolSuggestPluginKey.getState(editor.state) as { active: boolean }).active;

const PARAGRAPH = "<p>alpha</p>";
// Two items, so Tab in the second one has somewhere to sink to.
const LIST = "<ul><li><p>one</p></li><li><p>alpha</p></li></ul>";

beforeEach(() => {
  onKeyDown.mockClear();
  useSettingsStore.setState({ locale: "en", symbolSuggest: true });
});

afterEach(() => {
  editor?.destroy();
});

describe("Enter and Tab with the : menu open", () => {
  it.each([
    ["a paragraph", "Enter", PARAGRAPH],
    ["a paragraph", "Tab", PARAGRAPH],
    ["a bullet list item", "Enter", LIST],
    ["a bullet list item", "Tab", LIST],
  ])("in %s, %s goes to the menu and nothing else", async (_, key, content) => {
    await typeQuery(content);
    expect(active()).toBe(true);
    const before = editor.state.doc.toJSON();

    const event = press(key);

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0][0].key).toBe(key);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });
});

// The twins: the same keys with the menu closed do change these documents, so
// an unchanged document above means the menu took the key. Tab in a paragraph
// has no twin — with the menu closed it leaves the document as it was too
// (measured), so that case rests on the menu receiving the key.
describe("the same keys with the menu closed", () => {
  it.each([
    ["a paragraph", "Enter", PARAGRAPH],
    ["a bullet list item", "Enter", LIST],
    ["a bullet list item", "Tab", LIST],
  ])("in %s, %s edits the document", async (_, key, content) => {
    useSettingsStore.setState({ symbolSuggest: false });
    await typeQuery(content);
    expect(active()).toBe(false);
    const before = editor.state.doc.toJSON();

    press(key);

    expect(onKeyDown).not.toHaveBeenCalled();
    expect(editor.state.doc.toJSON()).not.toEqual(before);
  });
});

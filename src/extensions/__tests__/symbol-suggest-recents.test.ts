// §377 A pick from the `:` menu joins the recent list the symbol picker shows.
//
// The pick goes through the command the suggestion plugin hands its menu — the
// renderer is replaced to capture it — so this covers the wiring in
// symbol-suggest.ts, not a helper called by hand.
import type { SymbolSuggestionItem } from "../plugins/symbol-search";

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Command = (item: SymbolSuggestionItem) => void;

const menu = vi.hoisted(() => ({ command: null as Command | null }));

vi.mock("@tiptap/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tiptap/react")>()),
  ReactRenderer: class {
    element = document.createElement("div");
    ref = { onKeyDown: () => false };
    constructor(_component: unknown, options: { props: { command: Command } }) {
      menu.command = options.props.command;
    }
    destroy() {}
    updateProps(props: { command: Command }) {
      menu.command = props.command;
    }
  },
}));

import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";
import { typeChars } from "./helpers/type-chars";

let editor: Editor;

/** Type ` :ar` after "alpha" and let the suggestion view fetch its items. */
async function openMenu(): Promise<Command> {
  typeChars(editor, " :ar");
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!menu.command) throw new Error("the : menu did not open");
  return menu.command;
}

beforeEach(() => {
  menu.command = null;
  useSettingsStore.setState({
    locale: "en",
    recentSymbols: [],
    symbolSuggest: true,
  });
  editor = new Editor({
    content: "<p>alpha</p>",
    extensions: createBaramExtensions(),
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)),
  );
});

afterEach(() => {
  editor.destroy();
});

describe("the : menu and the recent list (§377)", () => {
  it("records nothing while the menu is only open", async () => {
    await openMenu();
    expect(useSettingsStore.getState().recentSymbols).toEqual([]);
  });

  it("records the character a pick writes", async () => {
    const command = await openMenu();
    command({ char: "→", id: "→", label: "right arrow" });
    expect(editor.getText()).toBe("alpha →");
    expect(useSettingsStore.getState().recentSymbols).toEqual(["→"]);
  });
});

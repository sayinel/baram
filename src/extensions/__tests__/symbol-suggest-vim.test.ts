import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { createBaramExtensions } from "../index";
import { symbolSuggestPluginKey } from "../plugins/suggestion-keys";
import { vimPluginKey } from "../plugins/vim/vim-keys";
import { type VimPluginState } from "../plugins/vim/vim-plugin-state";
import { typeChars } from "./helpers/type-chars";

let editor: Editor;

function esc(): void {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }),
  );
}

function insertModeEditor(): Editor {
  editor = new Editor({
    content: "<p>alpha</p>",
    extensions: createBaramExtensions(),
  });
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, { mode: "insert", type: "setMode" }),
  );
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
  );
  return editor;
}

const mode = () =>
  (vimPluginKey.getState(editor.state) as unknown as VimPluginState).mode;
const active = () =>
  (symbolSuggestPluginKey.getState(editor.state) as { active: boolean }).active;

beforeEach(() => {
  useSettingsStore.setState({ locale: "en", symbolSuggest: true });
});

afterEach(() => {
  editor?.destroy();
});

describe("vim Esc with the : menu (§298 arbitration)", () => {
  it("the first Esc closes the menu, the second leaves insert mode", () => {
    insertModeEditor();
    typeChars(editor, " :ar");
    expect(active()).toBe(true);

    esc();
    expect(active()).toBe(false);
    expect(mode()).toBe("insert");

    esc();
    expect(mode()).toBe("normal");
  });

  it.each([" :a", " :zzqq"])(
    "with nothing to show after %j, one Esc leaves insert mode",
    (typed) => {
      insertModeEditor();
      typeChars(editor, typed);
      expect(active()).toBe(false);

      esc();
      expect(mode()).toBe("normal");
    },
  );
});

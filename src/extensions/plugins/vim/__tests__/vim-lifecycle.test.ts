// §298 Vim Phase 1 — settings lifecycle (§7, S6).
//
// Pins: mount-time replay (an editor born after the toggle), live
// broadcast to EVERY registered editor, atomic disable, and a destroyed
// editor dropping out of the broadcast set.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../../stores/settings/store";
import { createBaramExtensions } from "../../../index";
import { vimPluginKey } from "../vim-keys";
import { type VimPluginState } from "../vim-plugin";

const editors: Editor[] = [];

function makeEditor(): Editor {
  const editor = new Editor({
    content: "<p>x</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

function vim(editor: Editor): VimPluginState {
  return vimPluginKey.getState(editor.state) as unknown as VimPluginState;
}

afterEach(() => {
  useSettingsStore.getState().setVimMode(false);
  for (const e of editors.splice(0)) e.destroy();
});

describe("vim settings lifecycle (§7)", () => {
  it("an editor born AFTER the toggle replays it on mount", () => {
    useSettingsStore.getState().setVimMode(true);
    const editor = makeEditor();
    expect(vim(editor).enabled).toBe(true);
    expect(vim(editor).mode).toBe("normal");
    expect(editor.view.editable).toBe(false);
  });

  it("toggling broadcasts to every live editor, both directions", () => {
    const a = makeEditor();
    const b = makeEditor();
    expect(vim(a).enabled).toBe(false);

    useSettingsStore.getState().setVimMode(true);
    expect(vim(a).mode).toBe("normal");
    expect(vim(b).mode).toBe("normal");

    useSettingsStore.getState().setVimMode(false);
    expect(vim(a).enabled).toBe(false);
    expect(vim(b).enabled).toBe(false);
    expect(a.view.editable).toBe(true);
  });

  it("a destroyed editor drops out of the broadcast — no crash", () => {
    const a = makeEditor();
    const b = makeEditor();
    a.destroy();
    useSettingsStore.getState().setVimMode(true);
    expect(vim(b).enabled).toBe(true);
  });
});

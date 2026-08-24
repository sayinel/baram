// §298 Vim Phase 1 — settings lifecycle (§7, S6).
//
// Pins: mount-time replay (an editor born after the toggle), live
// broadcast to EVERY registered editor, atomic disable, and a destroyed
// editor dropping out of the broadcast set.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../../../stores/settings/store";
import { setEditorEditable } from "../../../../utils/editor/editor-editable";
import { createBaramExtensions } from "../../../index";
import { registerCodeBlockEditableSync } from "../../../nodes/views/code-block-cm-registry";
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

describe("CM readOnly sync (§4-CM, S6)", () => {
  it("an editable flip reaches registered code blocks; steady state does not", () => {
    const editor = makeEditor();
    const seen: boolean[] = [];
    const unregister = registerCodeBlockEditableSync(editor.view, (e) =>
      seen.push(e),
    );

    useSettingsStore.getState().setVimMode(true);
    expect(seen.at(-1)).toBe(false); // modal → CM read-only

    const flips = seen.length;
    editor.view.dispatch(editor.state.tr.insertText("x", 1)); // no flip
    expect(seen.length).toBe(flips);

    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        mode: "insert",
        type: "setMode",
      }),
    );
    expect(seen.at(-1)).toBe(true); // insert → CM editable again
    unregister();
  });

  it("suspension unlocks CM islands; resume relocks (§4, R4)", () => {
    const editor = makeEditor();
    const seen: boolean[] = [];
    const unregister = registerCodeBlockEditableSync(editor.view, (e) =>
      seen.push(e),
    );
    useSettingsStore.getState().setVimMode(true);
    expect(seen.at(-1)).toBe(false);

    // Focus entered a data-vim-suspend island: vim passes keys through —
    // the island's own CM must accept them.
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        suspended: true,
        type: "setSuspended",
      }),
    );
    expect(seen.at(-1)).toBe(true);

    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        suspended: false,
        type: "setSuspended",
      }),
    );
    expect(seen.at(-1)).toBe(false);
    unregister();
  });

  it("real read-only wins over suspension (R5)", () => {
    const editor = makeEditor();
    const seen: boolean[] = [];
    const unregister = registerCodeBlockEditableSync(editor.view, (e) =>
      seen.push(e),
    );
    useSettingsStore.getState().setVimMode(true);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        suspended: true,
        type: "setSuspended",
      }),
    );
    expect(seen.at(-1)).toBe(true);

    setEditorEditable(editor, false); // base capability revoked
    expect(seen.at(-1)).toBe(false);
    unregister();
  });

  it("a block registering AFTER a broadcast replays the cached state (R5)", () => {
    const editor = makeEditor();
    useSettingsStore.getState().setVimMode(true); // broadcast happened
    const seen: boolean[] = [];
    const unregister = registerCodeBlockEditableSync(editor.view, (e) =>
      seen.push(e),
    );
    expect(seen).toEqual([false]); // immediate replay — lazy CM must not miss it
    unregister();
  });
});

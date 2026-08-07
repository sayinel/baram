// §298 Phase 0b S1 — the vim on/off channel for code block CM islands:
// broadcast from the vim PluginView, replay to late registrants.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../index";
import {
  broadcastCodeBlockVim,
  registerCodeBlockVimSync,
} from "../../../nodes/views/code-block-cm-registry";
import { vimPluginKey } from "../vim-keys";

const editors: Editor[] = [];

function makeEditor(): Editor {
  const editor = new Editor({
    content: "<p>a</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

describe("code block vim channel (S1)", () => {
  it("replays the last broadcast to a LATE registrant", () => {
    const view = {} as never;
    broadcastCodeBlockVim(view, true);
    const seen: boolean[] = [];
    const off = registerCodeBlockVimSync(view, (v) => seen.push(v));
    expect(seen).toEqual([true]);
    broadcastCodeBlockVim(view, false);
    expect(seen).toEqual([true, false]);
    off();
    broadcastCodeBlockVim(view, true);
    expect(seen).toEqual([true, false]); // unregistered — no delivery
  });

  it("enabling vim on the editor broadcasts to registered islands", () => {
    const editor = makeEditor();
    const seen: boolean[] = [];
    registerCodeBlockVimSync(editor.view, (v) => seen.push(v));
    expect(seen).toEqual([false]); // mount replay: vim starts disabled
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        enabled: true,
        type: "setEnabled",
      }),
    );
    expect(seen).toEqual([false, true]);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        enabled: false,
        type: "setEnabled",
      }),
    );
    expect(seen).toEqual([false, true, false]);
  });
});

// §260 — What a REAL Tiptap editor does when registering a plugin goes wrong.
//
// `editor-surfaces.ts` records each contribution's key before calling `registerPlugin`,
// and calls `unregisterPlugin` for keys that may never have landed. Both choices rest on
// two facts about the library, not about our own fake:
//
//   1. `registerPlugin` reconfigures the state and THEN updates the view, and
//      `updateState` assigns `view.state` before it renders — so a plugin whose rendering
//      throws is already installed when the call throws.
//   2. `unregisterPlugin` returns before touching the view when its filter removed
//      nothing — so removing a key the editor never had cannot fail.
//
// The repo owner hit (1) for real: a contributed plugin's decorations threw out of
// `iterDeco` at launch, and because the key went unrecorded the plugin stayed on the
// editor, so every later load collided with it. These two cases are here so a Tiptap
// upgrade that changed either order fails loudly instead of quietly reopening that.
import { Editor, Node } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { afterEach, describe, expect, test } from "vitest";

/** The smallest schema an Editor will accept; this file is about plugins, not nodes. */
const Paragraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
});

let editor: Editor | undefined;

function makeEditor(): Editor {
  editor = new Editor({
    extensions: [Document, Paragraph, Text],
    content: "<p>hello</p>",
  });
  return editor;
}

describe("tiptap's register/unregister ordering", () => {
  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  test("leaves the plugin installed when the view update throws", () => {
    const ed = makeEditor();
    const key = new PluginKey("baram-test:renders-badly");
    // Not a DecorationSet. `viewDecorations` hands it straight to the doc view, which
    // calls methods it does not have — the same shape as the owner's `localsInner` crash,
    // reached through the real rendering path rather than a stub of it.
    const broken = new Plugin({
      key,
      props: { decorations: () => ({}) as never },
    });

    expect(() => ed.registerPlugin(broken)).toThrow();

    // The call threw AND the plugin landed. Anything recorded only on a clean return
    // misses exactly this plugin.
    expect(ed.state.plugins).toContain(broken);
    // And the key is what takes it off again — which is all the unwind needs.
    ed.unregisterPlugin(key);
    expect(ed.state.plugins).not.toContain(broken);
  });

  test("removing a key the editor never had does nothing at all", () => {
    const ed = makeEditor();
    const before = ed.state.plugins;

    expect(() =>
      ed.unregisterPlugin(new PluginKey("baram-test:never-installed")),
    ).not.toThrow();

    // Same array, not merely an equal one: the filter removed nothing, so the state was
    // never reconfigured and the view was never updated. This is why recording a key
    // before its `registerPlugin` is free even when that call turns out to fail.
    expect(ed.state.plugins).toBe(before);
  });
});

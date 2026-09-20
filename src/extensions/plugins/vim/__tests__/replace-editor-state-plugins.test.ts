// §298 §12-7 · §260 — a whole-EditorState install must not carry a plugin set.
//
// Baram caches one EditorState per tab and restores it wholesale
// (`hooks/tab-switching/save-outgoing-tab.ts` → `restore-cached-state.ts`).
// `EditorState.plugins` rides along in that snapshot, so a tab switch used to
// hand the view a plugin list that predated — or outlived — whatever had been
// registered at runtime since. The repo owner found all four faces of it with a
// plugin contributing a ProseMirror plugin (§260):
//
//   - tabs already open when the plugin loaded never got its effect;
//   - unloading cleared it from the active tab only;
//   - loading again then threw "Adding different instances of a keyed plugin",
//     because a stale snapshot had put the removed instance back;
//   - and the load after that succeeded, because the throw had removed it.
//
// These tests run against a REAL Tiptap editor, because the defect is in what
// prosemirror-state and Tiptap actually do with a plugin list; a fake editor
// with a `plugins` array of its own cannot show any of it. That is not
// hypothetical — this branch first shipped the registry tested only against a
// fake, which is why the owner met this in the app rather than in CI.
import type { EditorState } from "@tiptap/pm/state";

import { Editor, Node } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { afterEach, describe, expect, test, vi } from "vitest";

import { replaceEditorStateWithVim } from "../replace-editor-state";

/** The smallest schema an Editor accepts; this file is about plugins, not nodes. */
const Paragraph = Node.create({
  content: "inline*",
  group: "block",
  name: "paragraph",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
});

const editors: Editor[] = [];

function makeEditor(content = "<p>hello</p>"): Editor {
  const editor = new Editor({
    content,
    element: document.body.appendChild(document.createElement("div")),
    extensions: [Document, Paragraph, Text],
  });
  editors.push(editor);
  return editor;
}

/**
 * What a tab switch caches: the live state object itself
 * (`save-outgoing-tab.ts` stores `prevEditor.state`), plugin list included.
 */
function cacheTabState(editor: Editor): EditorState {
  return editor.state;
}

/** A keyed plugin holding one number, so its field survival is observable. */
function counterPlugin(key: PluginKey<number>): Plugin {
  return new Plugin<number>({
    key,
    state: {
      apply: (tr, value) => (tr.getMeta(key) as number | undefined) ?? value,
      init: () => 0,
    },
  });
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

describe("replaceEditorStateWithVim reconciles the plugin set", () => {
  test("a state cached BEFORE a plugin loaded comes back carrying it", () => {
    // The owner's fourth symptom: tabs already open when the plugin loaded
    // never showed its effect, because switching back to one reinstalled a
    // snapshot from before the registration.
    const editor = makeEditor();
    const cached = cacheTabState(editor);
    const key = new PluginKey<number>("baram-test:loaded-after-cache");
    editor.registerPlugin(counterPlugin(key));

    replaceEditorStateWithVim(editor.view, cached, "cached-restore");

    expect(editor.state.plugins.map((p) => p.spec.key)).toContain(key);
    // And the cached document is what is on screen — the snapshot still owns
    // everything except the plugin list.
    expect(editor.state.doc.eq(cached.doc)).toBe(true);
  });

  test("a state cached WHILE a plugin was loaded comes back without it", () => {
    // Symptoms two and three together. Unloading takes the plugin off the live
    // view; installing a snapshot that still lists it puts the instance back,
    // and the next load then collides with it.
    const editor = makeEditor();
    const key = new PluginKey<number>("baram-test:unloaded-after-cache");
    const first = counterPlugin(key);
    editor.registerPlugin(first);
    const cached = cacheTabState(editor);
    editor.unregisterPlugin(key);

    replaceEditorStateWithVim(editor.view, cached, "cached-restore");

    // Asserted first because it is the symptom the user actually saw.
    // `editor-surfaces.ts` reuses one key per contribution across loads, so a
    // second load builds a NEW instance under the SAME key — a RangeError while
    // the stale one is still installed.
    expect(() => editor.registerPlugin(counterPlugin(key))).not.toThrow();
    expect(editor.state.plugins).not.toContain(first);
  });

  test("an identical plugin list is installed untouched", () => {
    // The common case: most call sites build their state from
    // `editor.state.plugins` already, so reconciling would rebuild every plugin
    // field for nothing.
    const editor = makeEditor();
    const same = editor.state.reconfigure({ plugins: editor.state.plugins });
    const updateState = vi.spyOn(editor.view, "updateState");

    replaceEditorStateWithVim(editor.view, same, "fresh-document");

    expect(updateState).toHaveBeenCalledTimes(1);
    expect(updateState.mock.calls[0]![0]).toBe(same);
  });

  test("a plugin in both lists keeps its state across the install", () => {
    // This is what keeps fold state and friends alive across a tab switch:
    // `reconfigure` carries over every field whose plugin key is still present.
    const editor = makeEditor();
    const survivor = new PluginKey<number>("baram-test:survivor");
    editor.registerPlugin(counterPlugin(survivor));
    editor.view.dispatch(editor.state.tr.setMeta(survivor, 7));
    const cached = cacheTabState(editor);
    expect(survivor.getState(cached)).toBe(7);

    // A second plugin arrives after the snapshot, forcing the reconcile.
    const latecomer = new PluginKey<number>("baram-test:latecomer");
    editor.registerPlugin(counterPlugin(latecomer));

    replaceEditorStateWithVim(editor.view, cached, "cached-restore");

    expect(survivor.getState(editor.state)).toBe(7);
    expect(latecomer.getState(editor.state)).toBe(0);
  });
});

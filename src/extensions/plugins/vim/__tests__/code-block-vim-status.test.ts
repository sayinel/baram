// §298 Phase 0b S4 — nested StatusBar ownership: a focused island owns the
// indicator; the PM feed is suppressed and replayed, never overwritten.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { useUIStore } from "../../../../stores/ui/ui";
import { createBaramExtensions } from "../../../index";
import { vimPluginKey } from "../vim-keys";
import {
  islandVimBlur,
  islandVimDispose,
  islandVimFocus,
  islandVimMode,
  publishWysiwygVimStatus,
  setWysiwygVimStatusOwner,
} from "../vim-status";

const editors: Editor[] = [];

function ownerEditor(): Editor {
  const editor = new Editor({
    content: "<p>a</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
  setWysiwygVimStatusOwner(editor);
  return editor;
}

function status() {
  return useUIStore.getState().vimStatus;
}

afterEach(() => {
  setWysiwygVimStatusOwner(null);
  for (const e of editors.splice(0)) e.destroy();
});

describe("code block vim status arbiter (S4)", () => {
  it("focus without a snapshot never claims the indicator", () => {
    ownerEditor();
    expect(status()).toEqual({ mode: "normal", surface: "wysiwyg" });
    const island = {};
    islandVimFocus(island);
    expect(status()).toEqual({ mode: "normal", surface: "wysiwyg" });
    islandVimDispose(island);
  });

  it("a focused island owns the indicator; PM publish is suppressed", () => {
    const editor = ownerEditor();
    const island = {};
    islandVimMode(island, "normal", editor.view);
    islandVimFocus(island);
    expect(status()).toEqual({ mode: "normal", surface: "codeblock" });
    // A CM edit dispatches a PM transaction → PluginView publishes — the
    // island must survive it (the exact first-keystroke overwrite path).
    islandVimMode(island, "insert");
    publishWysiwygVimStatus(editor.view);
    expect(status()).toEqual({ mode: "insert", surface: "codeblock" });
    // blur → the PM owner's snapshot is REPLAYED
    islandVimBlur(island);
    expect(status()).toEqual({ mode: "normal", surface: "wysiwyg" });
    islandVimDispose(island);
  });

  it("vim-off and dispose release the indicator back to PM", () => {
    ownerEditor();
    const a = {};
    islandVimMode(a, "normal");
    islandVimFocus(a);
    islandVimMode(a, null); // vim turned off for the island
    expect(status()).toEqual({ mode: "normal", surface: "wysiwyg" });

    const b = {};
    islandVimMode(b, "visual");
    islandVimFocus(b);
    expect(status()).toEqual({ mode: "visual", surface: "codeblock" });
    islandVimDispose(b);
    expect(status()).toEqual({ mode: "normal", surface: "wysiwyg" });
  });

  it("an owner switch invalidates a STALE island claim (keep-alive)", () => {
    const a = ownerEditor();
    const islandA = {};
    islandVimMode(islandA, "insert", a.view);
    islandVimFocus(islandA);
    expect(status()).toEqual({ mode: "insert", surface: "codeblock" });
    // owner moves to editor B while A's island blur is late/never
    const b = ownerEditor();
    expect(status()).toEqual({ mode: "normal", surface: "wysiwyg" });
    // and B's later publications are NOT swallowed
    publishWysiwygVimStatus(b.view);
    expect(status()).toEqual({ mode: "normal", surface: "wysiwyg" });
    islandVimDispose(islandA);
  });

  it("block→block focus moves hand over cleanly", () => {
    ownerEditor();
    const a = {};
    const b = {};
    islandVimMode(a, "insert");
    islandVimMode(b, "normal");
    islandVimFocus(a);
    expect(status()).toEqual({ mode: "insert", surface: "codeblock" });
    // focusout of a fires before focusin of b — a releases, b claims
    islandVimBlur(a);
    islandVimFocus(b);
    expect(status()).toEqual({ mode: "normal", surface: "codeblock" });
    // a's later mode updates must NOT leak while b owns
    islandVimMode(a, "visual");
    expect(status()).toEqual({ mode: "normal", surface: "codeblock" });
    islandVimDispose(a);
    islandVimDispose(b);
  });
});

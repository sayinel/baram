// §298 Phase 1 (§12-5): isWysiwygVimModal query semantics.
// The vim plugin does not exist yet — these tests pin the contract that
// guards (useExternalDrop 등) rely on: absent plugin → never modal;
// registered plugin → modal iff enabled && mode !== "insert".
import type { VimStateSnapshot } from "../plugins/vim/vim-keys";

import { Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "..";
import {
  chainWithVimExternalEdit,
  isVimExternalEdit,
  isWysiwygVimModal,
  vimPluginKey,
  withVimExternalEdit,
} from "../plugins/vim/vim-keys";

const editors: Editor[] = [];

function makeEditor(snapshot?: VimStateSnapshot) {
  const editor = new Editor({
    content: "<p>x</p>",
    extensions: createBaramExtensions(),
  });
  if (snapshot) {
    editor.registerPlugin(
      new Plugin<VimStateSnapshot>({
        key: vimPluginKey,
        state: { apply: (_tr, v) => v, init: () => snapshot },
      }),
    );
  }
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
});

describe("isWysiwygVimModal (§12-5)", () => {
  it("is false when no vim plugin is registered (dormant guard)", () => {
    expect(isWysiwygVimModal(makeEditor().state)).toBe(false);
  });

  it.each([
    [{ enabled: true, mode: "normal" }, true],
    [{ enabled: true, mode: "visual" }, true],
    [{ enabled: true, mode: "insert" }, false],
    [{ enabled: false, mode: "normal" }, false],
  ] as [VimStateSnapshot, boolean][])("%o → modal=%s", (snapshot, expected) => {
    expect(isWysiwygVimModal(makeEditor(snapshot).state)).toBe(expected);
  });
});

describe("vimExternalEdit provenance (§12-6)", () => {
  it("withVimExternalEdit tags, isVimExternalEdit reads, untagged is false", () => {
    const editor = makeEditor();
    const tagged = withVimExternalEdit(editor.state.tr);
    expect(isVimExternalEdit(tagged)).toBe(true);
    expect(isVimExternalEdit(editor.state.tr)).toBe(false);
  });

  it("chainWithVimExternalEdit covers every command in the chain (one tr)", () => {
    const editor = makeEditor();
    const seen: boolean[] = [];
    editor.registerPlugin(
      new Plugin({
        state: {
          apply: (tr, v: null) => {
            if (tr.docChanged) seen.push(isVimExternalEdit(tr));
            return v;
          },
          init: () => null,
        },
      }),
    );

    chainWithVimExternalEdit(editor)
      .setTextSelection({ from: 1, to: 2 })
      .toggleBold()
      .insertContentAt(editor.state.doc.content.size, "<p>tail</p>")
      .run();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);

    // Plain chain stays untagged.
    seen.length = 0;
    editor.chain().insertContentAt(0, "<p>head</p>").run();
    expect(seen).toEqual([false]);
  });
});

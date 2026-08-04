// §298 Vim Phase 1 — the §8 status feed (S5).
//
// The pins: only the APPOINTED owner publishes; appointing a new owner
// replays its snapshot at once (no stale mode across a tab switch); a
// vacated or destroyed owner leaves null behind.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { useUIStore } from "../../../../stores/ui/ui";
import { createBaramExtensions } from "../../../index";
import { vimPluginKey } from "../vim-keys";
import { setWysiwygVimStatusOwner } from "../vim-status";

const editors: Editor[] = [];

function enable(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(vimPluginKey, {
      enabled: true,
      type: "setEnabled",
    }),
  );
}

function makeEditor(): Editor {
  const editor = new Editor({
    content: "<p>x</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  setWysiwygVimStatusOwner(null);
  for (const e of editors.splice(0)) e.destroy();
  useUIStore.getState().setVimStatus(null);
});

describe("wysiwyg vim status (§8)", () => {
  it("the owner's mode reaches the store; a non-owner's does not", () => {
    const owner = makeEditor();
    const other = makeEditor();
    setWysiwygVimStatusOwner(owner);

    enable(other); // hidden editor — must stay invisible
    expect(useUIStore.getState().vimStatus).toBeNull();

    enable(owner);
    expect(useUIStore.getState().vimStatus).toEqual({
      mode: "normal",
      surface: "wysiwyg",
    });
  });

  it("appointing a new owner REPLAYS its snapshot at once", () => {
    const a = makeEditor();
    const b = makeEditor();
    setWysiwygVimStatusOwner(a);
    enable(a);
    expect(useUIStore.getState().vimStatus?.mode).toBe("normal");

    // b has vim disabled — switching to it must clear the indicator
    // without waiting for any transaction (§8 잔상 제거).
    setWysiwygVimStatusOwner(b);
    expect(useUIStore.getState().vimStatus).toBeNull();

    enable(b);
    expect(useUIStore.getState().vimStatus?.mode).toBe("normal");
  });

  it("vacating the owner (source surface active) clears the status", () => {
    const editor = makeEditor();
    setWysiwygVimStatusOwner(editor);
    enable(editor);
    expect(useUIStore.getState().vimStatus).not.toBeNull();

    setWysiwygVimStatusOwner(null);
    expect(useUIStore.getState().vimStatus).toBeNull();
  });

  it("destroying the owner editor clears the status", () => {
    const editor = makeEditor();
    setWysiwygVimStatusOwner(editor);
    enable(editor);
    expect(useUIStore.getState().vimStatus).not.toBeNull();

    editor.destroy();
    expect(useUIStore.getState().vimStatus).toBeNull();
  });

  it("mode transitions ride through: insert shows INSERT", () => {
    const editor = makeEditor();
    setWysiwygVimStatusOwner(editor);
    enable(editor);
    editor.view.dispatch(
      editor.state.tr.setMeta(vimPluginKey, {
        mode: "insert",
        type: "setMode",
      }),
    );
    expect(useUIStore.getState().vimStatus?.mode).toBe("insert");
  });
});

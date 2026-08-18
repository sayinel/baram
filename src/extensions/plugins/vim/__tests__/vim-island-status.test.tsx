// §298 vim §8 — the mode line must not lie while an island holds the keys.
//
// Entering a non-vim island (`i` on a math block focuses its textarea) keeps
// the StatusBar at `-- NORMAL --` while every keystroke goes into the island
// — the one place the mode line contradicts what keys actually do. Code
// blocks never had this: their CodeMirror island runs its own vim and claims
// the indicator through the island layer. These pins give the five plain
// islands the same honesty: suspension with a KNOWN island publishes
// `insert` plus the island label; release republishes the surface mode.
//
// jsdom quirks (repo test conventions): focusin does not fire from .focus()
// and must be dispatched manually; the release path re-evaluates the active
// element on a microtask.

import { act, render } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../../../stores/settings/store";
import { useUIStore } from "../../../../stores/ui/ui";
import { createBaramExtensions } from "../../../index";
import { setWysiwygVimStatusOwner } from "../vim-status";

vi.mock("katex", () => ({
  default: {
    render: (_expr: string, el: HTMLElement) => {
      el.textContent = "KATEX";
    },
  },
}));

const editors: Editor[] = [];

/** Flush React effects, microtasks, and rAF callbacks. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

const DOC: JSONContent = {
  content: [
    { content: [{ text: "above", type: "text" }], type: "paragraph" },
    { attrs: { formula: "E=mc^2" }, type: "mathBlock" },
    { content: [{ text: "below", type: "text" }], type: "paragraph" },
  ],
  type: "doc",
};

/** Enter the island the way vim's `i` preflight does: focus the textarea and
 *  let the focusin reach the surface (manual dispatch — jsdom). */
function focusIsland(): HTMLTextAreaElement {
  const ta = document.querySelector<HTMLTextAreaElement>(
    ".math-block textarea",
  )!;
  expect(ta).not.toBeNull();
  act(() => {
    ta.focus();
    ta.dispatchEvent(new FocusEvent("focus"));
    ta.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  return ta;
}

function mathPos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.forEach((node, at) => {
    if (node.type.name === "mathBlock") pos = at;
  });
  expect(pos).toBeGreaterThanOrEqual(0);
  return pos;
}

function setup(): Editor {
  useSettingsStore.setState({ vimMode: true });
  const editor = new Editor({
    content: DOC,
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  setWysiwygVimStatusOwner(editor);
  return editor;
}

afterEach(() => {
  setWysiwygVimStatusOwner(null);
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
  useUIStore.getState().setVimStatus(null);
});

describe("island focus publishes an insert status with the island label", () => {
  it("focusing the math island flips the feed to insert (math)", async () => {
    const editor = setup();
    await flush();
    expect(useUIStore.getState().vimStatus).toMatchObject({ mode: "normal" });

    act(() => {
      editor.commands.setNodeSelection(mathPos(editor));
    });
    await flush();
    focusIsland();
    await flush();

    expect(useUIStore.getState().vimStatus).toMatchObject({
      island: "math",
      mode: "insert",
      surface: "wysiwyg",
    });
  });

  it("release republishes the surface mode without the label", async () => {
    const editor = setup();
    await flush();
    act(() => {
      editor.commands.setNodeSelection(mathPos(editor));
    });
    await flush();
    const ta = focusIsland();
    await flush();
    expect(useUIStore.getState().vimStatus?.mode).toBe("insert");

    act(() => {
      editor.view.dom.focus();
      ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await flush(); // the release re-evaluates on a microtask

    const status = useUIStore.getState().vimStatus;
    expect(status?.mode).toBe("normal");
    expect(status?.island).toBeUndefined();
  });

  it("vim off leaves the feed alone (positive control)", async () => {
    useSettingsStore.setState({ vimMode: false });
    const editor = new Editor({
      content: DOC,
      extensions: createBaramExtensions(),
    });
    editors.push(editor);
    render(<EditorContent editor={editor} />);
    setWysiwygVimStatusOwner(editor);
    await flush();

    act(() => {
      editor.commands.setNodeSelection(mathPos(editor));
    });
    await flush();
    const ta = document.querySelector<HTMLTextAreaElement>(
      ".math-block textarea",
    );
    if (ta) {
      act(() => {
        ta.focus();
        ta.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      });
    }
    await flush();

    expect(useUIStore.getState().vimStatus).toBeNull();
  });
});

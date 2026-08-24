// §298 — every island exit must hand DOM focus back to the surface.
//
// The shared atom-block behavior exits (boundary arrows, Backspace-on-empty
// deletion) focused the editor with bare `view.focus()` / chain `.focus()` —
// and installed prosemirror-view guards its focus() behind `this.editable`,
// so under vim (non-editable surface) every one of those was a silent no-op.
// The island textarea then unmounts, focus falls to <body>, and vim is dead
// until the user clicks back into the document (adversarial review of the
// html port; the defect lives in the SHARED hook, so math, mermaid, svg and
// html all inherit it). Instance number eight of "PM machinery dies on
// non-editable views" — the cure is the same focusEditorView fallback the
// rest of the app already uses.
//
// Pinned through the html block (no mocks needed); the hook is shared, so
// one block exercises the fix for all four.

import { act, fireEvent, render } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../..";
import { useSettingsStore } from "../../../../stores/settings/store";

// jsdom has no layout: the caret-follow scroll (tr.scrollIntoView) walks
// getClientRects, which jsdom does not implement — polyfill the geometry the
// same way code-block-vim-wiring.test.ts does.
const zeroRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  toJSON: () => ({}),
  top: 0,
  width: 0,
  x: 0,
  y: 0,
};
Range.prototype.getBoundingClientRect ??= () => zeroRect as DOMRect;
Range.prototype.getClientRects ??= () =>
  ({
    item: () => null,
    length: 0,
    [Symbol.iterator]: [][Symbol.iterator],
  }) as unknown as DOMRectList;
HTMLElement.prototype.getClientRects ??= Range.prototype.getClientRects;

const editors: Editor[] = [];

function doc(content: string): JSONContent {
  return {
    content: [
      { content: [{ text: "above", type: "text" }], type: "paragraph" },
      { attrs: { content }, type: "htmlBlock" },
      { content: [{ text: "below", type: "text" }], type: "paragraph" },
    ],
    type: "doc",
  };
}

/** Flush React effects, dynamic-import microtasks, and rAF callbacks. */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 0));
    }
  });
}

function htmlPos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.forEach((node, at) => {
    if (node.type.name === "htmlBlock") pos = at;
  });
  expect(pos).toBeGreaterThanOrEqual(0);
  return pos;
}

/** Open the edit session through the vim path: select, focus the standby. */
async function openSession(
  editor: Editor,
  content: string,
): Promise<HTMLTextAreaElement> {
  useSettingsStore.setState({ vimMode: true });
  act(() => {
    editor.commands.setNodeSelection(htmlPos(editor));
  });
  await flush();
  const ta = document.querySelector<HTMLTextAreaElement>(
    ".html-block textarea",
  )!;
  expect(ta).not.toBeNull();
  act(() => {
    ta.focus();
    ta.dispatchEvent(new FocusEvent("focus"));
  });
  await flush();
  expect(ta.value).toBe(content);
  return ta;
}

function setup(content: string): Editor {
  const editor = new Editor({
    content: doc(content),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
  useSettingsStore.setState({ vimMode: false });
});

describe("boundary exits return DOM focus to the modal surface", () => {
  it("ArrowDown on the last line exits below AND focuses the view", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup("<div>hello</div>");
    await flush();
    const ta = await openSession(editor, "<div>hello</div>");

    act(() => {
      fireEvent.keyDown(ta, { key: "ArrowDown" });
    });
    await flush();

    expect(editor.state.selection.from).toBeGreaterThan(htmlPos(editor));
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it("ArrowUp on the first line exits above AND focuses the view", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup("<div>hello</div>");
    await flush();
    const ta = await openSession(editor, "<div>hello</div>");

    act(() => {
      fireEvent.keyDown(ta, { key: "ArrowUp" });
    });
    await flush();

    // exitBlock("up") parks the caret at the block boundary — at or above pos.
    expect(editor.state.selection.from).toBeLessThanOrEqual(htmlPos(editor));
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it("Backspace on an empty block deletes it AND focuses the view", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup("");
    await flush();
    const ta = await openSession(editor, "");

    act(() => {
      fireEvent.keyDown(ta, { key: "Backspace" });
    });
    await flush();

    let survives = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "htmlBlock") survives = true;
    });
    expect(survives).toBe(false);
    expect(document.activeElement).toBe(editor.view.dom);
  });
});

describe("exits keep the caret-follow scroll", () => {
  // Tiptap's chain .focus() also scheduled scrollIntoView; replacing it with
  // focusEditorView alone dropped the caret follow, so a boundary exit from a
  // tall block could land the selection off-screen (adversarial re-review).
  // jsdom has no layout, so the pin fixes the TRANSACTION's scroll flag.
  it("the exit transaction carries scrolledIntoView", async () => {
    useSettingsStore.setState({ vimMode: true });
    const editor = setup("<div>hello</div>");
    await flush();
    const ta = await openSession(editor, "<div>hello</div>");

    const scrolled: boolean[] = [];
    const orig = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = (tr) => {
      if (tr.selectionSet) scrolled.push(tr.scrolledIntoView);
      orig(tr);
    };
    act(() => {
      fireEvent.keyDown(ta, { key: "ArrowDown" });
    });
    await flush();

    expect(scrolled).toContain(true);
  });
});

describe("vim off keeps the ordinary exit (positive control)", () => {
  it("ArrowDown exit still lands below with the view focused", async () => {
    const editor = setup("<div>hello</div>");
    await flush();
    act(() => {
      editor.commands.setNodeSelection(htmlPos(editor));
    });
    await flush();
    const ta = document.querySelector<HTMLTextAreaElement>(
      ".html-block textarea",
    )!;

    act(() => {
      fireEvent.keyDown(ta, { key: "ArrowDown" });
    });
    await flush();

    expect(editor.state.selection.from).toBeGreaterThan(htmlPos(editor));
    expect(document.activeElement).toBe(editor.view.dom);
  });
});

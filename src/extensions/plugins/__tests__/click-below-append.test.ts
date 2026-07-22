import type { EditorView } from "@tiptap/pm/view";

import { Editor } from "@tiptap/core";
// §4.2 Click-below-to-append — clicking the empty editor area below the last
// block appends a paragraph (Notion/Logseq). Geometry (last block's bottom
// edge) is mocked because jsdom has no layout.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../index";
import { handleClickBelowContent } from "../click-below-append";

const LAST_BLOCK_BOTTOM = 100;

function clickAt(
  target: EventTarget,
  clientY: number,
  init: MouseEventInit = {},
): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientY,
    ...init,
  });
  // jsdom only sets target on dispatch; the handler is called directly.
  Object.defineProperty(event, "target", { value: target });
  return event;
}

function mockLastChildRect(view: EditorView, bottom: number) {
  const last = view.dom.lastElementChild as HTMLElement;
  last.getBoundingClientRect = () =>
    ({
      bottom,
      top: bottom - 20,
      left: 0,
      right: 500,
      width: 500,
      height: 20,
      x: 0,
      y: bottom - 20,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("ClickBelowAppend: click on empty space below the last block", () => {
  let editor: Editor;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: createBaramExtensions(),
      content: "<h1>Title</h1><p>hello</p>",
    });
    mockLastChildRect(editor.view, LAST_BLOCK_BOTTOM);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("appends an empty paragraph and places the caret in it", () => {
    const before = editor.state.doc.childCount;

    const handled = handleClickBelowContent(
      editor.view,
      clickAt(editor.view.dom, LAST_BLOCK_BOTTOM + 50),
    );

    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(before + 1);
    const last = editor.state.doc.lastChild!;
    expect(last.type.name).toBe("paragraph");
    expect(last.content.size).toBe(0);
    // Caret sits inside the new trailing paragraph
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it("focuses an existing trailing empty paragraph instead of appending", () => {
    editor.commands.setContent("<p>hello</p><p></p>");
    mockLastChildRect(editor.view, LAST_BLOCK_BOTTOM);
    const before = editor.state.doc.childCount;
    expect(editor.state.doc.lastChild!.content.size).toBe(0);

    const handled = handleClickBelowContent(
      editor.view,
      clickAt(editor.view.dom, LAST_BLOCK_BOTTOM + 50),
    );

    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(before);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it("ignores clicks above the last block's bottom edge", () => {
    const docBefore = editor.state.doc;

    const handled = handleClickBelowContent(
      editor.view,
      clickAt(editor.view.dom, LAST_BLOCK_BOTTOM - 50),
    );

    expect(handled).toBe(false);
    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  it("ignores clicks whose target is a node's own DOM", () => {
    const p = editor.view.dom.querySelector("p")!;
    const docBefore = editor.state.doc;

    const handled = handleClickBelowContent(
      editor.view,
      clickAt(p, LAST_BLOCK_BOTTOM + 50),
    );

    expect(handled).toBe(false);
    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  it("ignores modified clicks (shift / meta / ctrl / alt / non-left)", () => {
    const docBefore = editor.state.doc;
    const modifiers: MouseEventInit[] = [
      { shiftKey: true },
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { button: 2 },
    ];
    for (const init of modifiers) {
      const handled = handleClickBelowContent(
        editor.view,
        clickAt(editor.view.dom, LAST_BLOCK_BOTTOM + 50, init),
      );
      expect(handled).toBe(false);
    }
    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  it("ignores clicks while the windowing bottom spacer (--vbot) is active", () => {
    editor.view.dom.style.setProperty("--vbot", "480px");
    const docBefore = editor.state.doc;

    const handled = handleClickBelowContent(
      editor.view,
      clickAt(editor.view.dom, LAST_BLOCK_BOTTOM + 50),
    );

    expect(handled).toBe(false);
    expect(editor.state.doc.eq(docBefore)).toBe(true);

    // Spacer collapsed (scrolled to the real document end) → active again
    editor.view.dom.style.setProperty("--vbot", "0px");
    const handledAfter = handleClickBelowContent(
      editor.view,
      clickAt(editor.view.dom, LAST_BLOCK_BOTTOM + 50),
    );
    expect(handledAfter).toBe(true);
  });

  it("does nothing in read-only mode", () => {
    editor.setEditable(false);
    const docBefore = editor.state.doc;

    const handled = handleClickBelowContent(
      editor.view,
      clickAt(editor.view.dom, LAST_BLOCK_BOTTOM + 50),
    );

    expect(handled).toBe(false);
    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });
});

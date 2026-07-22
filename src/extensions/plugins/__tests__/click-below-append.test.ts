import { Editor } from "@tiptap/core";
// §4.2 Click-below-to-append — pressing the empty area below the last block
// appends a paragraph (Notion/Logseq). Driven by a document-level mousedown
// listener + preventDefault so a WKWebView text-selection drag can't suppress
// it. jsdom has no layout, so block geometry is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "../../index";
import { handleEmptyAreaMousedown } from "../click-below-append";

const LAST_BLOCK_BOTTOM = 100;

/** A MouseEvent-shaped object for direct handler calls, with a preventDefault spy. */
function fakeEvent(
  target: Element,
  clientY: number,
  init: Partial<MouseEvent> = {},
): MouseEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    button: 0,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    clientY,
    target,
    preventDefault: vi.fn(),
    ...init,
  } as unknown as MouseEvent & { preventDefault: ReturnType<typeof vi.fn> };
}

function mockRect(el: Element, bottom: number) {
  el.getBoundingClientRect = () =>
    ({
      bottom,
      top: Math.max(0, bottom - 20),
      left: 0,
      right: 500,
      width: 500,
      height: 20,
      x: 0,
      y: Math.max(0, bottom - 20),
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("handleEmptyAreaMousedown: press on the editor root below the last block", () => {
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
    mockRect(editor.view.dom.lastElementChild!, LAST_BLOCK_BOTTOM);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("appends an empty paragraph, places the caret, and preventDefaults", () => {
    const before = editor.state.doc.childCount;
    const event = fakeEvent(editor.view.dom, LAST_BLOCK_BOTTOM + 30);

    const handled = handleEmptyAreaMousedown(editor.view, event);

    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(editor.state.doc.childCount).toBe(before + 1);
    const last = editor.state.doc.lastChild!;
    expect(last.type.name).toBe("paragraph");
    expect(last.content.size).toBe(0);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it("focuses an existing trailing empty paragraph instead of appending", () => {
    editor.commands.setContent("<p>hello</p><p></p>");
    mockRect(editor.view.dom.lastElementChild!, LAST_BLOCK_BOTTOM);
    const before = editor.state.doc.childCount;

    const handled = handleEmptyAreaMousedown(
      editor.view,
      fakeEvent(editor.view.dom, LAST_BLOCK_BOTTOM + 30),
    );

    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(before);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  // Regression (01_corpus_definition.md): a document ending in an empty
  // paragraph. The blank trailing line IS the empty area the user clicks, but
  // the press lands INSIDE that paragraph's box (above its bottom), and
  // WKWebView won't place the caret there natively — so nothing happened. The
  // guard must treat a trailing empty paragraph's whole box as empty area.
  it("focuses a trailing empty paragraph when the press lands inside its box", () => {
    editor.commands.setContent("<p>hello</p><p></p>");
    // Empty paragraph spans top=80..bottom=100 (mockRect derives top).
    const emptyPara = editor.view.dom.lastElementChild!;
    mockRect(emptyPara, LAST_BLOCK_BOTTOM);
    const before = editor.state.doc.childCount;

    // y=90 is inside the empty paragraph (80..100) — above its bottom, which
    // the old bottom-edge guard wrongly rejected.
    const handled = handleEmptyAreaMousedown(
      editor.view,
      fakeEvent(emptyPara, LAST_BLOCK_BOTTOM - 10),
    );

    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(before); // focus, not append
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it("ignores presses above a trailing empty paragraph (on real content)", () => {
    editor.commands.setContent("<p>hello</p><p></p>");
    mockRect(editor.view.dom.lastElementChild!, LAST_BLOCK_BOTTOM); // top=80
    const docBefore = editor.state.doc;

    // y=70 is above the empty paragraph's top (80) → real content, not empty area.
    expect(
      handleEmptyAreaMousedown(
        editor.view,
        fakeEvent(editor.view.dom, LAST_BLOCK_BOTTOM - 30),
      ),
    ).toBe(false);
    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  it("ignores presses above the last block's bottom edge", () => {
    const docBefore = editor.state.doc;
    const event = fakeEvent(editor.view.dom, LAST_BLOCK_BOTTOM - 30);

    expect(handleEmptyAreaMousedown(editor.view, event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  it("ignores presses within the last block (target is content, at/above its bottom)", () => {
    const p = editor.view.dom.querySelector("p")!;
    const docBefore = editor.state.doc;

    // clientY inside the block → the geometry guard rejects it as real content.
    expect(
      handleEmptyAreaMousedown(
        editor.view,
        fakeEvent(p, LAST_BLOCK_BOTTOM - 10),
      ),
    ).toBe(false);
    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  // Regression (01_corpus_definition.md): when the document fills the viewport,
  // WKWebView hit-tests the thin padding band below the last block as the last
  // block's own <p> — so event.target is a document node even though the press
  // is genuinely in the empty area. The geometry guard (below the last block's
  // bottom) must win over the target's identity.
  it("appends when the target is the last block's <p> but the press is below it", () => {
    const p = editor.view.dom.querySelector("p")!;
    const before = editor.state.doc.childCount;

    const handled = handleEmptyAreaMousedown(
      editor.view,
      fakeEvent(p, LAST_BLOCK_BOTTOM + 30),
    );

    expect(handled).toBe(true);
    expect(editor.state.doc.childCount).toBe(before + 1);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it("ignores modified presses (shift / meta / ctrl / alt / non-left)", () => {
    const docBefore = editor.state.doc;
    const mods: Partial<MouseEvent>[] = [
      { shiftKey: true },
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { button: 2 },
    ];
    for (const init of mods) {
      expect(
        handleEmptyAreaMousedown(
          editor.view,
          fakeEvent(editor.view.dom, LAST_BLOCK_BOTTOM + 30, init),
        ),
      ).toBe(false);
    }
    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  it("ignores presses while a block-handle menu is open (dismissal click)", () => {
    const menu = document.createElement("div");
    menu.className = "block-handle-menu";
    document.body.appendChild(menu);
    const docBefore = editor.state.doc;

    expect(
      handleEmptyAreaMousedown(
        editor.view,
        fakeEvent(editor.view.dom, LAST_BLOCK_BOTTOM + 30),
      ),
    ).toBe(false);
    expect(editor.state.doc.eq(docBefore)).toBe(true);
    menu.remove();
  });

  it("ignores presses while the windowing bottom spacer (--vbot) is active", () => {
    editor.view.dom.style.setProperty("--vbot", "480px");
    const docBefore = editor.state.doc;

    expect(
      handleEmptyAreaMousedown(
        editor.view,
        fakeEvent(editor.view.dom, LAST_BLOCK_BOTTOM + 30),
      ),
    ).toBe(false);
    expect(editor.state.doc.eq(docBefore)).toBe(true);

    editor.view.dom.style.setProperty("--vbot", "0px");
    expect(
      handleEmptyAreaMousedown(
        editor.view,
        fakeEvent(editor.view.dom, LAST_BLOCK_BOTTOM + 30),
      ),
    ).toBe(true);
  });

  it("does nothing in read-only mode", () => {
    editor.setEditable(false);
    const docBefore = editor.state.doc;

    expect(
      handleEmptyAreaMousedown(
        editor.view,
        fakeEvent(editor.view.dom, LAST_BLOCK_BOTTOM + 30),
      ),
    ).toBe(false);
    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });
});

// Plugin wiring — the real document-level mousedown listener over the app's DOM
// structure: [data-editor-scroll] > toggle wrapper > EditorContent host >
// .tiptap. In the real app .tiptap does NOT fill the scroll area, so presses in
// the band below it land on the scroll container and never reach ProseMirror.
describe("ClickBelowAppend: mousedown on the scroll band below the editor", () => {
  let editor: Editor;
  let scroll: HTMLElement;
  let wrapper: HTMLElement;
  let host: HTMLElement;

  function press(target: EventTarget & Node, clientY: number) {
    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0, clientY }),
    );
  }

  beforeEach(() => {
    scroll = document.createElement("div");
    scroll.setAttribute("data-editor-scroll", "");
    wrapper = document.createElement("div");
    host = document.createElement("div");
    wrapper.appendChild(host);
    scroll.appendChild(wrapper);
    document.body.appendChild(scroll);
    editor = new Editor({
      element: host,
      extensions: createBaramExtensions(),
      content: "<h1>Title</h1><p>hello</p>",
    });
    // The geometry guard compares against the last block's bottom edge.
    mockRect(editor.view.dom.lastElementChild!, LAST_BLOCK_BOTTOM);
  });

  afterEach(() => {
    editor.destroy();
    scroll.remove();
  });

  it("appends when pressing the scroll container below the editor", () => {
    const before = editor.state.doc.childCount;

    press(scroll, LAST_BLOCK_BOTTOM + 40);

    expect(editor.state.doc.childCount).toBe(before + 1);
    const last = editor.state.doc.lastChild!;
    expect(last.type.name).toBe("paragraph");
    expect(last.content.size).toBe(0);
    expect(editor.state.selection.from).toBe(editor.state.doc.content.size - 1);
  });

  it("appends when pressing a wrapper between the scroll container and the editor", () => {
    const before = editor.state.doc.childCount;

    press(wrapper, LAST_BLOCK_BOTTOM + 40);

    expect(editor.state.doc.childCount).toBe(before + 1);
  });

  it("ignores presses above the last block's bottom edge", () => {
    const docBefore = editor.state.doc;

    press(scroll, LAST_BLOCK_BOTTOM - 40);

    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  it("ignores presses on overlay elements inside the scroll container", () => {
    const overlay = document.createElement("button");
    scroll.appendChild(overlay);
    const docBefore = editor.state.doc;

    press(overlay, LAST_BLOCK_BOTTOM + 40);

    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  it("ignores presses while this editor instance is hidden (keep-alive)", () => {
    wrapper.style.display = "none";
    const docBefore = editor.state.doc;

    press(scroll, LAST_BLOCK_BOTTOM + 40);

    expect(editor.state.doc.eq(docBefore)).toBe(true);
  });

  it("stops listening after the editor is destroyed", () => {
    editor.destroy();

    press(scroll, LAST_BLOCK_BOTTOM + 40);

    expect(editor.isDestroyed).toBe(true);
  });
});

import { Editor } from "@tiptap/core";
// Regression: folding the LAST heading of a document made it impossible to
// unfold — and, in fact, broke every mousedown in the editor.
//
// Folding a heading marks every block after it `.fold-hidden` (display:none),
// so `view.dom.lastElementChild` reports an all-zero rect. click-below-append
// used that element's bottom edge as "the end of the content", so 0 became the
// threshold and EVERY press looked like it landed in the empty area below the
// document. It then called preventDefault() — and ProseMirror's
// `eventBelongsToView` drops any event whose default was already prevented, so
// no plugin's handleDOMEvents ran at all, the heading fold arrow included.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../index";
import { foldPluginKey } from "../fold";

/**
 * Lay out the rendered children the way a browser would: visible blocks get a
 * 30px band each, `.fold-hidden` blocks collapse to an all-zero rect.
 */
function layout(editor: Editor) {
  let y = 0;
  for (const child of editor.view.dom.children) {
    if (child.classList.contains("fold-hidden")) {
      zeroRect(child);
    } else {
      rectAt(child, y, y + 30);
      y += 30;
    }
  }
}

/** A press on a heading's CSS ::before gutter arrow: target is the heading,
 *  offsetX is negative (left of its content box). See resolveHeadingGutterFold. */
function pressGutter(el: Element, clientY: number) {
  const ev = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientY,
  });
  Object.defineProperty(ev, "offsetX", { value: -10 });
  el.dispatchEvent(ev);
  return ev;
}

function rectAt(el: Element, top: number, bottom: number) {
  el.getBoundingClientRect = () =>
    ({
      bottom,
      top,
      left: 0,
      right: 500,
      width: 500,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** display:none elements report an all-zero rect in a real browser. */
function zeroRect(el: Element) {
  el.getBoundingClientRect = () =>
    ({
      bottom: 0,
      top: 0,
      left: 0,
      right: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("Fold: heading gutter arrow click", () => {
  let editor: Editor;
  let scroll: HTMLElement;
  let host: HTMLElement;

  beforeEach(() => {
    // Mirror the app's DOM: [data-editor-scroll] > host > .tiptap, so the
    // click-below-append document listener sees the same structure it does live.
    scroll = document.createElement("div");
    scroll.setAttribute("data-editor-scroll", "");
    host = document.createElement("div");
    scroll.appendChild(host);
    document.body.appendChild(scroll);
    editor = new Editor({
      element: host,
      extensions: createBaramExtensions(),
      // "Mid" is followed by a same-or-higher level heading, so folding it
      // leaves trailing content visible; "Last" runs to the end of the doc.
      content:
        "<h1>Intro</h1><p>alpha</p><h2>Mid</h2><p>beta</p><h1>Last</h1><p>gamma</p>",
    });
  });

  afterEach(() => {
    editor.destroy();
    scroll.remove();
  });

  const foldedPositions = () => [
    ...(foldPluginKey.getState(editor.state)?.foldedPositions ?? []),
  ];

  /** The heading element whose text starts with `text`. */
  function headingEl(text: string): HTMLElement {
    const el = [...editor.view.dom.querySelectorAll("h1, h2")].find((h) =>
      h.textContent?.startsWith(text),
    );
    return el as HTMLElement;
  }

  function midOf(el: Element): number {
    const r = el.getBoundingClientRect();
    return r.top + (r.bottom - r.top) / 2;
  }

  it("folds a heading when its gutter arrow is pressed", () => {
    layout(editor);
    const h2 = headingEl("Last");

    pressGutter(h2, midOf(h2));

    expect(foldedPositions()).toHaveLength(1);
    expect(editor.state.doc.nodeAt(foldedPositions()[0])?.type.name).toBe(
      "heading",
    );
  });

  it("unfolds the LAST heading of the document on a second gutter press", () => {
    layout(editor);
    pressGutter(headingEl("Last"), midOf(headingEl("Last")));
    expect(foldedPositions()).toHaveLength(1);

    // Everything after the heading is now display:none — re-measure as a
    // browser would before the second press.
    layout(editor);
    const docBefore = editor.state.doc;
    pressGutter(headingEl("Last"), midOf(headingEl("Last")));

    expect(foldedPositions()).toEqual([]);
    // The press must not have been hijacked into appending a paragraph.
    expect(editor.state.doc.childCount).toBe(docBefore.childCount);
  });

  it("unfolds a heading that is NOT last (control: trailing block stays visible)", () => {
    layout(editor);
    pressGutter(headingEl("Mid"), midOf(headingEl("Mid")));
    expect(foldedPositions()).toHaveLength(1);

    layout(editor);
    pressGutter(headingEl("Mid"), midOf(headingEl("Mid")));
    expect(foldedPositions()).toEqual([]);
  });

  it("keeps the rest of the editor clickable while the last heading is folded", () => {
    layout(editor);
    pressGutter(headingEl("Last"), midOf(headingEl("Last")));
    layout(editor);

    const firstP = editor.view.dom.querySelector("p") as HTMLElement;
    const before = editor.state.doc.childCount;
    const ev = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientY: midOf(firstP),
    });
    firstP.dispatchEvent(ev);

    // A plain press on real content must reach ProseMirror untouched: no
    // preventDefault, no appended paragraph, no caret teleported to doc end.
    expect(ev.defaultPrevented).toBe(false);
    expect(editor.state.doc.childCount).toBe(before);
  });
});

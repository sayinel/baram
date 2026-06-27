import { Editor } from "@tiptap/core";
// §5.1 Toggle — clicking the toggle's own box (arrow / left padding) flips `open`.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../index";

describe("Toggle: gutter/arrow click flips open", () => {
  let editor: Editor;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: createBaramExtensions(),
      content: "<p>seed</p>",
    });
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { open: true },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Head" }] },
            { type: "paragraph", content: [{ type: "text", text: "Body" }] },
          ],
        },
      ],
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it("the rendered toggle element carries data-type=toggle", () => {
    const el = editor.view.dom.querySelector('[data-type="toggle"]');
    expect(el).not.toBeNull();
    expect((el as HTMLElement).matches('div[data-type="toggle"]')).toBe(true);
  });

  it("mousedown on the toggle element flips open=false", () => {
    const el = editor.view.dom.querySelector(
      '[data-type="toggle"]',
    ) as HTMLElement;
    expect(editor.state.doc.child(0).attrs.open).toBe(true);

    el.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(editor.state.doc.child(0).attrs.open).toBe(false);
  });
});

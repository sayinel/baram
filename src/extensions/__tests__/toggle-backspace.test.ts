import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
// §5.1 Toggle — Backspace on an empty line right after a toggle moves the cursor
// into the toggle's visible end (summary end if collapsed, last body block end if
// open) instead of merging into a possibly-hidden child.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../index";

describe("Toggle: Backspace on the empty line after a toggle", () => {
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
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  /** Build: a toggle (summary "Head" + body "Body") followed by an empty para. */
  function setupDoc(open: boolean) {
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "toggle",
          attrs: { open },
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Head" }] },
            { type: "paragraph", content: [{ type: "text", text: "Body" }] },
          ],
        },
        { type: "paragraph" },
      ],
    });
    // Cursor at the start of the trailing empty paragraph.
    const toggle = editor.state.doc.child(0);
    const emptyParaStart = toggle.nodeSize + 1; // +1 to enter the paragraph
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, emptyParaStart),
    );
    editor.view.dispatch(tr);
  }

  function pressBackspace() {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Backspace",
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  it("collapsed toggle: deletes the empty line, cursor lands at summary end", () => {
    setupDoc(false);
    pressBackspace();

    // Empty paragraph is gone — only the toggle remains.
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.child(0).type.name).toBe("toggle");

    // Cursor is inside the summary (first child), at the end of "Head".
    const { $from } = editor.state.selection;
    expect($from.parent.textContent).toBe("Head");
    expect($from.parentOffset).toBe(4);
  });

  it("open toggle: deletes the empty line, cursor lands at last body block end", () => {
    setupDoc(true);
    pressBackspace();

    expect(editor.state.doc.childCount).toBe(1);
    const { $from } = editor.state.selection;
    expect($from.parent.textContent).toBe("Body");
    expect($from.parentOffset).toBe(4);
  });
});

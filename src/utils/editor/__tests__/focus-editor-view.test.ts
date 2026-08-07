// §298 vim — PM's own focus() is editable-gated, so a non-editable
// (vim-modal) surface never receives DOM focus from it.

import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../../extensions";
import { focusEditorView } from "../focus-editor-view";

const editors: Editor[] = [];

function makeEditor(): Editor {
  const editor = new Editor({
    content: "<p>alpha</p>",
    element: document.body.appendChild(document.createElement("div")),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  document.body.innerHTML = "";
});

describe("focusEditorView", () => {
  it("focuses an EDITABLE view (PM's own path)", () => {
    const editor = makeEditor();
    focusEditorView(editor.view);
    expect(editor.view.hasFocus()).toBe(true);
  });

  it("focuses a NON-EDITABLE view, which view.focus() alone will not", () => {
    const editor = makeEditor();
    editor.setEditable(false);
    // vim modal supplies tabindex through its attributes prop; mirror that.
    editor.view.dom.setAttribute("tabindex", "0");
    document.body.focus();
    expect(document.activeElement).not.toBe(editor.view.dom);

    editor.view.focus(); // PM declines: `if (this.editable)`
    expect(document.activeElement).not.toBe(editor.view.dom);

    focusEditorView(editor.view);
    expect(document.activeElement).toBe(editor.view.dom);
  });
});

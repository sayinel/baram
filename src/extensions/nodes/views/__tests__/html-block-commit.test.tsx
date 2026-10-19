// §5.1 — committing an HTML block's edit.

import type { JSONContent } from "@tiptap/core";

import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../..";

const editors: Editor[] = [];

function docWith(content: string): JSONContent {
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

function setup(): Editor {
  const editor = new Editor({
    content: docWith("<div>hello</div>"),
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.innerHTML = "";
});

const BLOCK_AT = 1 + "above".length + 1;

function textarea(): HTMLTextAreaElement {
  const ta = document.querySelector<HTMLTextAreaElement>(
    ".html-block textarea",
  );
  expect(ta).not.toBeNull();
  return ta!;
}

/** Open the block and type `content` into its textarea. */
async function typeIntoBlock(editor: Editor, content: string): Promise<void> {
  act(() => {
    editor.commands.setNodeSelection(BLOCK_AT);
  });
  await flush();
  act(() => {
    textarea().focus();
    fireEvent.change(textarea(), { target: { value: content } });
  });
  await flush();
}

/** The document's blocks between "above" and "below", as JSON. */
function middle(editor: Editor): JSONContent[] {
  const { doc } = editor.state;
  expect(doc.firstChild?.textContent).toBe("above");
  expect(doc.lastChild?.textContent).toBe("below");
  return ((doc.toJSON() as JSONContent).content ?? []).slice(1, -1);
}

describe("a document replaced while the block holds typing", () => {
  // A reload sets a whole new document (`setContent`, as a file window does
  // for an external change) while the textarea still holds unsaved typing;
  // ProseMirror reuses this view for the new document's HTML block. What
  // fails this: committing on the deselect that follows — the typing lands in
  // the new document's block.
  it("does not write the typing into the new document on deselect", async () => {
    const editor = setup();
    await flush();
    await typeIntoBlock(editor, "<div>typed</div>");

    act(() => {
      editor.commands.setContent(docWith("<div>other</div>"));
    });
    await flush();

    expect(middle(editor)).toEqual([
      { attrs: { content: "<div>other</div>" }, type: "htmlBlock" },
    ]);
  });

  // With the HTML block last, the selection stays on the new document's
  // block and the session stays open. What fails this: committing on the
  // keyboard exit (or any path other than the deselect), which writes the
  // typing over the reloaded block — or leaving the typing in the textarea.
  it("shows the new text and keeps it on Esc", async () => {
    const lastBlock = (above: string, content: string): JSONContent => ({
      content: [
        { content: [{ text: above, type: "text" }], type: "paragraph" },
        { attrs: { content }, type: "htmlBlock" },
      ],
      type: "doc",
    });
    const editor = new Editor({
      content: lastBlock("above", "<div>hello</div>"),
      extensions: createBaramExtensions(),
    });
    editors.push(editor);
    render(<EditorContent editor={editor} />);
    await flush();
    await typeIntoBlock(editor, "<div>typed</div>");

    act(() => {
      editor.commands.setContent(lastBlock("other", "<div>other</div>"));
    });
    await flush();
    expect(textarea().value).toBe("<div>other</div>");

    act(() => {
      fireEvent.keyDown(textarea(), { key: "Escape" });
    });
    await flush();

    expect(editor.state.doc.child(1).attrs.content).toBe("<div>other</div>");
  });
});

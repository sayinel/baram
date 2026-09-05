// issue 542 — the table toolbar's ⋯ button still toggles its popup after the
// menu's dismiss moved to the capture phase.
//
// MenuList used to close on the ⋯ mousedown (bubble) BEFORE the button's
// onClick, so the button remembered "was it open at mousedown" to avoid
// reopening. With a capture-phase dismiss that memory would race the close.
// The button is now the popup's `toggleRef`: its mousedown does not dismiss,
// and onClick flips the real state. This pins the contract from the outside:
// click opens, click closes (and does not reopen), click opens again, and a
// mousedown anywhere else closes.
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { TableToolbar } from "../TableToolbar";

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function mountTableWithToolbar() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return rectFor(this);
    },
  );
  const editor = new Editor({ extensions: createBaramExtensions() });
  editors.push(editor);
  const view = render(
    <div className="editor-area-scroll">
      <EditorContent editor={editor} />
      <TableToolbar editor={editor} />
    </div>,
  );
  act(() => {
    editor.commands.setContent(
      markdownToProsemirror(
        "| a | b |\n| --- | --- |\n| c | d |\n",
        editor.schema,
      ).toJSON(),
    );
  });
  await flush();
  let cellTextPos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (cellTextPos === -1 && node.isText && node.text === "c") {
      cellTextPos = pos;
    }
    return cellTextPos === -1;
  });
  if (cellTextPos === -1) throw new Error("table cell text did not mount");
  act(() => {
    editor.commands.setTextSelection(cellTextPos + 1);
  });
  await flush();
  const more = await waitFor(() => view.getByTitle("More"));
  return { editor, more, view };
}

function popupOpen(): boolean {
  return document.body.querySelector(".context-menu") !== null;
}

/** jsdom has no layout; the toolbar shows itself only when the table sits
 *  inside the visible part of `.editor-area-scroll`, so hand it rects. */
function rectFor(el: Element): DOMRect {
  const r = (top: number, height: number, width = 600) =>
    ({
      bottom: top + height,
      height,
      left: 0,
      right: width,
      top,
      width,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  if (el.classList.contains("editor-area-scroll")) return r(0, 800);
  // The table's DOM (its NodeView wrapper or the <table> itself), anything
  // else in the editor: well inside the scroll area.
  if (el.closest(".editor-area-scroll")) return r(200, 200);
  return r(0, 0, 0);
}

describe("the ⋯ overflow popup toggles from its button", () => {
  it("opens, closes without reopening, opens again", async () => {
    const { more } = await mountTableWithToolbar();

    fireEvent.mouseDown(more, { button: 0 });
    fireEvent.click(more);
    await flush();
    expect(popupOpen()).toBe(true);

    fireEvent.mouseDown(more, { button: 0 });
    fireEvent.click(more);
    await flush();
    expect(popupOpen()).toBe(false);

    fireEvent.mouseDown(more, { button: 0 });
    fireEvent.click(more);
    await flush();
    expect(popupOpen()).toBe(true);
  });

  it("closes on a mousedown anywhere else", async () => {
    const { more } = await mountTableWithToolbar();
    fireEvent.mouseDown(more, { button: 0 });
    fireEvent.click(more);
    await flush();
    expect(popupOpen()).toBe(true);

    fireEvent.mouseDown(document.body, { button: 0 });
    await flush();

    expect(popupOpen()).toBe(false);
  });
});

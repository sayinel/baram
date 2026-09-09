// Shared TableToolbar render fixture — extracted from
// table-toolbar-overflow-toggle.test.tsx (issue 542) so ai-toolbar-gates.test.tsx
// (§338) can prove the ✨ button actually disappears at runtime instead of only
// scanning source text. Same move Task 7 made for createMockEditor, same
// reason: a second ~60-line copy would drift from the first.
import type { RenderResult } from "@testing-library/react";

import { act, render, waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { vi } from "vitest";

// Names come from the catalogue, not from literals here.
import en from "../../../i18n/en.json";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { TableToolbar } from "../TableToolbar";

export const editors: Editor[] = [];

/** Call from each test file's own `afterEach`, alongside RTL's `cleanup()`. */
export function cleanupEditors(): void {
  for (const e of editors.splice(0)) e.destroy();
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

export async function mountTableWithToolbar(): Promise<{
  editor: Editor;
  more: HTMLElement;
  view: RenderResult;
}> {
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
  // By accessible name: the bar's buttons carry the app's pill now, and this one names
  // itself more fully for assistive tech than the pill does on screen.
  const more = await waitFor(() =>
    view.getByLabelText(en["tableToolbar.moreOptions"]),
  );
  return { editor, more, view };
}

/** jsdom has no layout; the toolbar shows itself only when the table sits
 *  inside the visible part of `.editor-area-scroll`, so hand it rects. */
export function rectFor(el: Element): DOMRect {
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

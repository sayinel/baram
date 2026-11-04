// §394 spec 0073 D12 · plan 0125 Task 12 fix M1 — a `data-plugin-block` written into a document's
// SVG block. The block's markup sits outside an HTML block's `.html-block-render`, so
// `isAuthoredMarkup` cannot tell its forged mark from a rendered root; the document sanitizers
// therefore drop the marker, as they drop the vim island markers. React NodeViews (the SVG block's)
// draw only under `EditorContent`, so this row mounts one.
import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  invoke: vi.fn(async () => undefined),
}));

import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { pendingHeavyBlocks } from "../export-heavy-blocks";
import {
  bindChart,
  cleanUp,
  exported,
  showAll,
  templateOf,
} from "./helpers/plugin-block-editor";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  cleanUp();
});

/** What fails this: a sanitizer that keeps the marker — settle then waits on the forged `<g>`
 *  (a "plugin" entry that never settles: the export stalls for the whole budget), and the pairing
 *  gives the real block's export to the `<g>` inside the `<svg>`, leaving the real root unpaired.
 *  The pair: the SVG's own content stays. */
it("neither waits on nor pairs a data-plugin-block an SVG block's author wrote", async () => {
  bindChart(async (source) => ({ html: `<p>drawn ${source}</p>` }));
  const editor = new Editor({
    content: "<p>seed</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent(
      markdownToProsemirror(
        '```svg\n<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><g data-plugin-block=""><text>forged</text></g></svg>\n```\n\n```chart\nC\n```\n',
        editor.schema,
      ).toJSON(),
    );
  });
  act(() => showAll());
  // Not `[data-plugin-block]`: the forged `<g>` comes first in the document.
  const root = editor.view.dom.querySelector(
    'div[data-lang="chart"]',
  ) as HTMLElement;
  await vi.waitFor(() => {
    expect(editor.view.dom.querySelector(".svg-block-render g")).not.toBeNull();
    expect(root.dataset.renderState).toBe("done");
  });
  expect(pendingHeavyBlocks(editor.view.dom)).toEqual([]);
  const doc = await exported(editor);
  expect(doc.querySelector("svg g")?.textContent).toBe("forged");
  expect(doc.querySelector("svg .plugin-block-export")).toBeNull();
  expect(templateOf(doc)?.textContent).toBe("drawn C");
  expect(doc.querySelector("[data-plugin-block]")).toBeNull();
});

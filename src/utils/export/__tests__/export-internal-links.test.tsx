// §5.12 export — internal references become real links.
//
// User report (2026-08-23): "블록참조 등 참조 링크 사라짐" — reference links
// disappear. They do not disappear visually: a block reference exports as its
// purple chip and a footnote reference as its superscript number. What is gone
// is the LINK. Both are navigated in the editor by JavaScript (Cmd+click for a
// block reference, a click handler for a footnote), and a PDF has no
// JavaScript, so the chip that says "^intro" in the export is a dead label —
// the reader can see there is a reference and cannot follow it. Chrome emits a
// PDF link annotation for a same-document anchor, so the fix is to give the
// export the anchors the editor never needed.
//
// Only SAME-DOCUMENT targets can be linked. A reference into another note has
// no destination inside a single exported file, and a link to nowhere is worse
// than none; those keep the chip and stay unlinked, which is asserted below so
// the rule cannot quietly widen.
import { act, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  invoke: vi.fn(async () => undefined),
}));

import { createBaramExtensions } from "../../../extensions";
import { markdownToProsemirror } from "../../../pipeline";
import { captureEditorHTML } from "../export-html";

const editors: Editor[] = [];

afterEach(() => {
  for (const e of editors) e.destroy();
  editors.length = 0;
});

async function exportOf(markdown: string): Promise<Document> {
  const editor = new Editor({
    content: "<p>seed</p>",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  render(<EditorContent editor={editor} />);
  act(() => {
    editor.commands.setContent(
      markdownToProsemirror(markdown, editor.schema).toJSON(),
    );
  });
  await flush();
  const html = await captureEditorHTML(editor, { forPdf: true });
  await flush();
  return new DOMParser().parseFromString(
    `<article>${html}</article>`,
    "text/html",
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

const BLOCK_REF_MD = [
  "the target paragraph ^intro",
  "",
  "a reference to ((#^intro)) here",
].join("\n");

describe("a block reference to a block in the same document", () => {
  it("becomes an anchor pointing at its target", async () => {
    const doc = await exportOf(BLOCK_REF_MD);
    const link = doc.querySelector("a.block-reference");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("#block-intro");
  });

  it("gives the target an id for that anchor to land on", async () => {
    const doc = await exportOf(BLOCK_REF_MD);
    const target = doc.querySelector("#block-intro");
    expect(target).not.toBeNull();
    expect(target?.textContent).toContain("the target paragraph");
  });

  it("keeps the chip's own class, so it still looks like a reference", async () => {
    const doc = await exportOf(BLOCK_REF_MD);
    expect(doc.querySelector("a.block-reference")?.textContent).toBe("^intro");
  });
});

describe("a block reference into ANOTHER document", () => {
  it("stays unlinked, because the target is not in this file", async () => {
    // Discriminating: if the rule linked on blockId alone, this would produce
    // `href="#block-abc"` pointing at nothing — a link the reader can click
    // that silently does nothing, which is what §301 already rejected for
    // local video.
    const doc = await exportOf("see ((other-note#^abc)) for details");
    expect(doc.querySelector("a.block-reference")).toBeNull();
    expect(doc.querySelector(".block-reference")).not.toBeNull();
  });
});

describe("footnotes", () => {
  const MD = "text with a note[^a]\n\nmore text\n\n[^a]: the note body";

  it("links the reference to its definition", async () => {
    const doc = await exportOf(MD);
    const ref = doc.querySelector("a.footnote-ref");
    expect(ref?.getAttribute("href")).toBe("#fn-a");
    expect(doc.querySelector("#fn-a")).not.toBeNull();
  });

  it("links the definition back to its reference", async () => {
    const doc = await exportOf(MD);
    const back = doc.querySelector("a.footnote-definition-label");
    expect(back?.getAttribute("href")).toBe("#fnref-a");
    expect(doc.querySelector("#fnref-a")).not.toBeNull();
  });

  it("keeps the numbering the editor showed", async () => {
    const doc = await exportOf(MD);
    expect(doc.querySelector("a.footnote-ref")?.textContent).toBe("1");
    expect(doc.querySelector("a.footnote-definition-label")?.textContent).toBe(
      "1.",
    );
  });
});

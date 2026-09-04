// issue 527 — the wiring pin: both markdown export routes actually run the
// link policy on what leaves the app.
//
// export-markdown-links.test.ts proves the pass itself; this file proves that
// exportWithPandoc and exportForNotion call it, last, on the string they hand
// to the Rust pandoc command and to the .md file. A real editor is loaded
// through the pipeline and serialized by the real route code; only the save
// dialog and the IPC boundary are doubled, so the markdown captured here is
// exactly what pandoc / Notion would have received.
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => "/tmp/baram-export-test-out"),
}));
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  exportBinaryFile: vi.fn(async () => undefined),
  exportPandoc: vi.fn(async () => undefined),
}));
// link.ts's Cmd+click path reaches the OS opener; keep it inert here.
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

import { createBaramExtensions } from "../../../extensions";
import { exportBinaryFile, exportPandoc } from "../../../ipc/invoke";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { exportForNotion, exportWithPandoc } from "../export";

// Inline links only: the editor pipeline does not carry reference-style
// links or definitions through a load/serialize cycle, so they cannot reach
// either route from a live document. (The pipeline behaviour itself is pinned
// in export-markdown-links.test.ts for strings that arrive by other means.)
const DOC =
  "[bad](javascript:alert(document.domain)) and [good](https://example.com/a)\n\nsee <vbscript:x> too\n";

const editors: Editor[] = [];

function loadEditor(markdown: string): Editor {
  const editor = new Editor({
    content: "",
    extensions: createBaramExtensions(),
  });
  editors.push(editor);
  editor.commands.setContent(
    markdownToProsemirror(markdown, editor.schema).toJSON(),
  );
  return editor;
}

afterEach(() => {
  for (const e of editors.splice(0)) e.destroy();
  vi.mocked(exportPandoc).mockClear();
  vi.mocked(exportBinaryFile).mockClear();
});

function expectPolicyApplied(markdown: string): void {
  expect(markdown).not.toContain("javascript:");
  expect(markdown).not.toContain("<vbscript:x>");
  expect(markdown).toContain("bad");
  // The allowed neighbour keeps its destination.
  expect(markdown).toContain("[good](https://example.com/a)");
}

describe("the markdown that reaches pandoc", () => {
  it("has the refused links reduced to their labels", async () => {
    const editor = loadEditor(DOC);
    await exportWithPandoc(editor, "t", "docx");

    expect(vi.mocked(exportPandoc)).toHaveBeenCalledTimes(1);
    expectPolicyApplied(vi.mocked(exportPandoc).mock.calls[0][0]);
  });
});

describe("the markdown written for Notion", () => {
  it("has the refused links reduced to their labels", async () => {
    const editor = loadEditor(DOC);
    await exportForNotion(editor, "t");

    expect(vi.mocked(exportBinaryFile)).toHaveBeenCalledTimes(1);
    const bytes = vi.mocked(exportBinaryFile).mock.calls[0][1];
    expectPolicyApplied(new TextDecoder().decode(new Uint8Array(bytes)));
  });
});

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

import type { ContextInfo } from "../../../ipc/types";

import { createBaramExtensions } from "../../../extensions";
import { exportBinaryFile, exportPandoc } from "../../../ipc/invoke";
import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { useContextStore } from "../../../stores/context/context";
import { useUIStore } from "../../../stores/ui/ui";
import { exportForNotion, exportWithPandoc } from "../export";

// Inline links, and (issue 546) a reference-style link: the editor resolves
// `[bad][r]` + `[r]: …` to an inline link at load, so a document AUTHORED with
// references reaches both routes as inline links and meets the same policy.
// (The pass itself is pinned in export-markdown-links.test.ts for strings that
// arrive by other means, definitions included.)
const DOC =
  "[bad](javascript:alert(document.domain)) and [good](https://example.com/a)\n\nsee <vbscript:x> too\n";
const REFERENCE_DOC =
  "[bad][r] and [good](https://example.com/a)\n\nsee <vbscript:x> too\n\n[r]: javascript:alert(document.domain)\n";

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
    expectPolicyApplied(
      vi.mocked(exportPandoc).mock.calls[0][0].markdownContent,
    );
  });

  it("applies to a document authored with a reference-style link too (issue 546)", async () => {
    const editor = loadEditor(REFERENCE_DOC);
    await exportWithPandoc(editor, "t", "docx");

    expect(vi.mocked(exportPandoc)).toHaveBeenCalledTimes(1);
    const { markdownContent: markdown } =
      vi.mocked(exportPandoc).mock.calls[0][0];
    expectPolicyApplied(markdown);
    // The definition line is gone too — not by this policy: the editor resolved
    // the reference to an inline link when it loaded the document and dropped
    // the definition then (`pipeline/reference-links.ts`, issue 546), so the
    // markdown handed to Pandoc never had it.
    expect(markdown).not.toContain("[r]:");
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

// issue 545 — the image policy runs on the same string, before the link policy,
// and the backend receives the relative images to stage, the document path and
// the id of the vault or folder context that owns the document.
describe("the images in the markdown that reaches pandoc", () => {
  const IMAGE_DOC =
    "![hosts](/etc/hosts) ![pixel](https://tracker.example/p.gif) ![local](img/a.png)\n\n[bad](javascript:alert(1))\n";
  const context = (
    id: string,
    path: string,
    contextType: ContextInfo["contextType"],
  ): ContextInfo => ({
    addedAt: 0,
    color: "",
    contextType,
    id,
    label: id,
    path,
  });

  afterEach(() => {
    useContextStore.setState({ activeContextId: null, contexts: [] });
    useUIStore.setState({ toast: null });
  });

  it("stages the relative image, reduces the rest to alt text, and names the owning context", async () => {
    useContextStore.setState({
      contexts: [
        context("ctx-file", "/vault/notes/today.md", "file"),
        context("ctx-vault", "/vault", "vault"),
      ],
    });
    const editor = loadEditor(IMAGE_DOC);
    await exportWithPandoc(editor, "t", "docx", {
      documentPath: "/vault/notes/today.md",
    });

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
    const markdown = request.markdownContent;
    expect(markdown).not.toContain("/etc/hosts");
    expect(markdown).not.toContain("tracker.example");
    expect(markdown).toContain("hosts");
    expect(markdown).toContain("pixel");
    expect(markdown).toContain("![local](baram-asset:image-0.png)");
    // The link policy still ran last on the same string.
    expect(markdown).not.toContain("javascript:");
    // images, then the document path (the backend takes its directory) and
    // the context whose canonical root bounds what the backend may read.
    expect(request.images).toEqual([
      { name: "image-0.png", source: "img/a.png" },
    ]);
    expect(request.documentPath).toBe("/vault/notes/today.md");
    expect(request.documentContextId).toBe("ctx-vault");
  });

  it("owns the document by the deepest directory context holding it, never a File context", async () => {
    // A lone-file context for this very file exists (openTab backfills the
    // tab's context id from whatever was active): a File context authorizes
    // one file, so the deepest directory context holding the document owns
    // it — and not the wider vault, which would let `../` climb past the
    // folder the user opened on purpose.
    useContextStore.setState({
      contexts: [
        context("ctx-file", "/vault/notes/today.md", "file"),
        context("ctx-vault", "/vault", "vault"),
        context("ctx-notes", "/vault/notes", "folder"),
      ],
    });
    const editor = loadEditor(IMAGE_DOC);
    await exportWithPandoc(editor, "t", "docx", {
      documentPath: "/vault/notes/today.md",
    });

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
    expect(request.documentContextId).toBe("ctx-notes");
    expect(request.images).toEqual([
      { name: "image-0.png", source: "img/a.png" },
    ]);
  });

  it("tells the user how many images were left out, and why", async () => {
    useContextStore.setState({
      contexts: [context("ctx-vault", "/vault", "vault")],
    });
    const editor = loadEditor(IMAGE_DOC);
    await exportWithPandoc(editor, "t", "docx", {
      documentPath: "/vault/notes/today.md",
    });
    // `/etc/hosts` and the tracker pixel were left out; `img/a.png` was not.
    const toast = useUIStore.getState().toast;
    expect(toast?.type).toBe("warning");
    expect(toast?.message).toContain("2");
    expect(toast?.message).toContain("left out");
  });

  it("refuses relative images for a document no directory context holds, and says so", async () => {
    useContextStore.setState({
      contexts: [context("ctx-other", "/elsewhere", "vault")],
    });
    const editor = loadEditor("![local](img/a.png)\n");
    await exportWithPandoc(editor, "t", "docx", {
      documentPath: "/vault/notes/today.md",
    });

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
    expect(request.markdownContent).toBe("local\n");
    expect(request.images).toEqual([]);
    expect(request.documentContextId).toBeUndefined();
    // The notice names the cure: save the note inside an open vault or folder.
    expect(useUIStore.getState().toast?.message).toContain("vault or folder");
  });

  it("turns the editor's resized <img> into a markdown image for LaTeX, source as written", async () => {
    useContextStore.setState({
      contexts: [context("ctx-vault", "/vault", "vault")],
    });
    const editor = loadEditor(
      '<img src="img/a.png" alt="A" width="640">\n\n<img src="/etc/hosts" width="50%">\n',
    );
    await exportWithPandoc(editor, "t", "latex", {
      documentPath: "/vault/notes/today.md",
    });

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
    // No staging, no verdict — the reference passes through as written, with
    // its width; a raw `<img>` would have been dropped by the policy filter.
    expect(request.markdownContent).toContain("![A](img/a.png){width=640px}");
    expect(request.markdownContent).toContain("![](/etc/hosts){width=50%}");
    expect(request.markdownContent).not.toContain("<img");
    expect(request.images).toEqual([]);
  });

  it("leaves images as written for LaTeX and RST, which embed nothing", async () => {
    useContextStore.setState({
      contexts: [context("ctx-vault", "/vault", "vault")],
    });
    const editor = loadEditor(IMAGE_DOC);
    await exportWithPandoc(editor, "t", "latex", {
      documentPath: "/vault/notes/today.md",
    });

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
    // pandoc writes these references and opens no file for them.
    expect(request.markdownContent).toContain("![hosts](/etc/hosts)");
    expect(request.markdownContent).toContain("![local](img/a.png)");
    expect(request.images).toEqual([]);
  });

  it("refuses relative images for a document that was never saved and sends no path", async () => {
    const editor = loadEditor("![local](img/a.png)\n");
    await exportWithPandoc(editor, "t", "docx");

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
    expect(request.markdownContent).toBe("local\n");
    expect(request.images).toEqual([]);
    expect(request.documentPath).toBeUndefined();
    expect(request.documentContextId).toBeUndefined();
  });
});

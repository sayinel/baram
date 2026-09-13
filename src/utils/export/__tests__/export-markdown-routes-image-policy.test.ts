// issue 545 / issue 631 — the wiring pin for the image policy on the Pandoc
// route: exportWithPandoc runs it on the string it hands to the Rust pandoc
// command, names the context that owns the document, sends the images to
// stage, and tells the user what was left out. A real editor is loaded
// through the pipeline and serialized by the real route code; only the save
// dialog and the IPC boundary are doubled. The policy itself is pinned in
// export-markdown-images*.test.ts; this file pins the route.
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

import { exportBinaryFile, exportPandoc } from "../../../ipc/invoke";
import { useContextStore } from "../../../stores/context/context";
import { useUIStore } from "../../../stores/ui/ui";
import { createEditorFixture } from "../../__tests__/helpers/editor-fixture";
import { exportWithPandoc } from "../export";

const { dispose: disposeEditors, load: loadEditor } = createEditorFixture();

afterEach(() => {
  disposeEditors();
  vi.mocked(exportPandoc).mockClear();
  vi.mocked(exportBinaryFile).mockClear();
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

  it("tells the user, separately, about an HTML block the image policy could not read (issue 631)", async () => {
    useContextStore.setState({
      contexts: [context("ctx-vault", "/vault", "vault")],
    });
    // pandoc reads the fenced tag as code; the policy leaves the block whole
    // rather than pick inside it (export-html-fragment.ts), and says so.
    const editor = loadEditor(
      '![hosts](/etc/hosts)\n\n<div>\n```\n<img src="img/a.png">\n```\n<img src="img/b.png">\n</div>\n',
    );
    await exportWithPandoc(editor, "t", "docx", {
      documentPath: "/vault/notes/today.md",
    });

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
    expect(request.markdownContent).toContain('<img src="img/b.png">');
    expect(request.images).toEqual([]);
    // The store holds one toast: both sentences arrive in it, the definite
    // count first.
    const toast = useUIStore.getState().toast;
    expect(toast?.type).toBe("warning");
    expect(toast?.message).toMatch(/^1 image\(s\) were left out/);
    expect(toast?.message).toContain(
      "Images in 1 HTML fragment(s) may be missing",
    );
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

  it("embeds a resized image at its size as the editor itself writes the tag (writer to reader)", async () => {
    useContextStore.setState({
      contexts: [context("ctx-vault", "/vault", "vault")],
    });
    // The editor round-trips the tag through its own writer, which spells
    // it `<img … />`; that spelling, not a hand-written one, is what the
    // export reads.
    const editor = loadEditor('<img src="img/a.png" alt="A" width="640" />\n');
    await exportWithPandoc(editor, "t", "docx", {
      documentPath: "/vault/notes/today.md",
    });

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
    expect(request.markdownContent).toContain(
      "![A](baram-asset:image-0.png){width=640px}",
    );
    expect(request.images).toEqual([
      { name: "image-0.png", source: "img/a.png" },
    ]);
    expect(useUIStore.getState().toast).toBeNull();
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

  it("finds the owning context on Windows across drive-letter case and mixed separators (issue 631)", async () => {
    useContextStore.setState({
      contexts: [context("ctx-vault", "C:\\Vault", "vault")],
    });
    const editor = loadEditor(IMAGE_DOC);
    await exportWithPandoc(editor, "t", "docx", {
      documentPath: "c:/vault/notes/today.md",
    });

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
    expect(request.images).toEqual([
      { name: "image-0.png", source: "img/a.png" },
    ]);
    expect(request.documentContextId).toBe("ctx-vault");
  });

  it("leaves images as written for RST too", async () => {
    useContextStore.setState({
      contexts: [context("ctx-vault", "/vault", "vault")],
    });
    const editor = loadEditor(IMAGE_DOC);
    await exportWithPandoc(editor, "t", "rst", {
      documentPath: "/vault/notes/today.md",
    });

    const [request] = vi.mocked(exportPandoc).mock.calls[0];
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

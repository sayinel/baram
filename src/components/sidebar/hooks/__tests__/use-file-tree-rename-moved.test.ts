// §33 A rename that carries other files along — renaming a PDF moves its
// highlight note and sidecar — names each in `moved`. The hook moves what the
// app holds for each, as for the renamed file: the tree entry, the cached
// content and every open tab. A tab left on the old path would write the note
// back there on its next save, beside the moved one (`writeFile` creates a
// missing file).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../ipc/invoke")>()),
  readFile: vi.fn(async () => ""),
  refreshIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
  renameFileWithLinks: vi.fn(),
  renameNamespace: vi.fn(),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

import type { EditorTab } from "../../../../stores/editor/editor";

import { saveDirtyTab } from "../../../../hooks/use-close-guard";
import { renameFileWithLinks, writeFile } from "../../../../ipc/invoke";
import { useEditorStore } from "../../../../stores/editor/editor";
import { useFileStore } from "../../../../stores/file/file";
import { useFileTreeRename } from "../use-file-tree-rename";

const PDF = "/vault/papers/Paper.pdf";
const NOTE = "/vault/highlights/papers/Paper.md";
const MOVED_NOTE = "/vault/highlights/papers/Survey.md";

function tab(id: string, filePath: string, title: string): EditorTab {
  return {
    contextId: "",
    filePath,
    id,
    isDirty: id === "note",
    isPinned: false,
    title,
  };
}

beforeEach(() => {
  vi.mocked(renameFileWithLinks).mockReset();
  vi.mocked(writeFile).mockClear();
  useFileStore.setState({
    fileTree: [
      {
        children: [{ isDir: false, name: "Paper.pdf", path: PDF }],
        isDir: true,
        name: "papers",
        path: "/vault/papers",
      },
    ],
    openFiles: new Map([[NOTE, "edited quote ^h1\n"]]),
    rootPath: "/vault",
  });
  useEditorStore.setState({
    activeTabId: "pdf",
    tabs: [tab("pdf", PDF, "Paper.pdf"), tab("note", NOTE, "Paper.md")],
  });
});

describe("files a rename carried along (§33 moved)", () => {
  it("moves an open tab on the PDF's highlight note, and its next save writes the new path", async () => {
    // What fails this: following the renamed file alone in
    // `handleConfirmRename` — the note's tab keeps `Paper.md`, and the save
    // below writes the old path, recreating the note beside the moved one.
    vi.mocked(renameFileWithLinks).mockResolvedValue({
      moved: [
        { from: NOTE, to: MOVED_NOTE },
        {
          from: "/vault/.baram/pdf-highlights/papers/Paper.json",
          to: "/vault/.baram/pdf-highlights/papers/Survey.json",
        },
      ],
      skippedFiles: [],
      updatedFiles: [],
    });
    const { result } = renderHook(() => useFileTreeRename({ current: null }));
    await act(() => result.current.handleConfirmRename(PDF, "Survey.pdf"));

    const tabs = useEditorStore.getState().tabs;
    expect(tabs.map((t) => [t.filePath, t.title])).toEqual([
      ["/vault/papers/Survey.pdf", "Survey.pdf"],
      [MOVED_NOTE, "Survey.md"],
    ]);
    // The note's unsaved text moved with it.
    const { openFiles } = useFileStore.getState();
    expect(openFiles.get(MOVED_NOTE)).toBe("edited quote ^h1\n");
    expect(openFiles.has(NOTE)).toBe(false);

    const noteTab = tabs.find((t) => t.id === "note");
    if (!noteTab) throw new Error("the note's tab is gone");
    await saveDirtyTab(noteTab, "pdf", async () => {});
    expect(writeFile).toHaveBeenCalledWith(MOVED_NOTE, "edited quote ^h1\n");
    expect(writeFile).not.toHaveBeenCalledWith(NOTE, expect.anything());
  });
});

// External OS file drop → FileTree copy path.
//
// This path shipped with zero tests and was dead in the app: `detectZone()`
// hit-tests `.file-tree`'s bounding rect, but `.file-tree` is content-sized
// inside the taller `.sidebar-content` scroll container, so its rect stopped at
// the last row. Every drop below the last row — the largest, most natural
// target — resolved to zone `null` and was discarded in silence. Measured in
// the running app: drop at (154, 940) with `.file-tree` bottom = 850.
//
// The rect half of that cannot be asserted here: jsdom reports every
// getBoundingClientRect as all-zero, so a jsdom assertion would pass whether or
// not the layout is fixed. It is pinned by a bound source guard at the bottom
// of this file plus a manual drop in the running app.
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const importDirMock = vi.hoisted(() => vi.fn());
const importFileMock = vi.hoisted(() => vi.fn());
const listDirMock = vi.hoisted(() => vi.fn());
const showToastMock = vi.hoisted(() => vi.fn());

vi.mock("../../ipc/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    ...actual,
    createDir: vi.fn(async () => undefined),
    importDir: importDirMock,
    importFile: importFileMock,
    listDir: listDirMock,
  };
});
vi.mock("../../stores/ui/ui", () => ({
  useUIStore: { getState: () => ({ showToast: showToastMock }) },
}));

import { createBaramExtensions } from "../../extensions";
import { Image } from "../../extensions/nodes/image";
import { Paragraph } from "../../extensions/nodes/paragraph";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { handleEditorDrop, handleFileTreeDrop } from "../use-external-drop";

const ROOT = "/vault";
const NOTES = "/vault/notes";
const SOURCE = "/Users/x/Desktop/paper.md";

/** Build the real FileTree DOM shape: a folder wrapper carrying
 *  `data-drop-path` that CONTAINS its child rows. */
function mountTree(): {
  emptyArea: HTMLElement;
  folderRow: HTMLElement;
  nestedFileRow: HTMLElement;
  rootFileRow: HTMLElement;
} {
  document.body.innerHTML = `
    <div class="file-tree">
      <div data-drop-path="${NOTES}">
        <div class="file-tree-item file-tree-dir" id="folderRow"></div>
        <div class="file-tree-item file-tree-file" id="nestedFileRow"></div>
      </div>
      <div class="file-tree-item file-tree-file" id="rootFileRow"></div>
    </div>`;
  const q = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    folderRow: q("folderRow"),
    nestedFileRow: q("nestedFileRow"),
    rootFileRow: q("rootFileRow"),
    emptyArea: document.querySelector(".file-tree") as HTMLElement,
  };
}

describe("handleFileTreeDrop — where the copy lands", () => {
  beforeEach(() => {
    importFileMock.mockReset().mockResolvedValue(undefined);
    listDirMock.mockReset().mockResolvedValue([]);
    showToastMock.mockReset();
    useFileStore.setState({ rootPath: ROOT, fileTree: [] } as never);
  });

  it("copies into the folder whose row is under the cursor", async () => {
    const { folderRow } = mountTree();
    await handleFileTreeDrop([SOURCE], folderRow);
    expect(importFileMock).toHaveBeenCalledWith(SOURCE, `${NOTES}/paper.md`);
  });

  it("copies into the containing folder when the cursor is on a file row inside it", async () => {
    // The folder wrapper encloses its children, so `closest('[data-drop-path]')`
    // from a nested file row already resolves to that file's own directory.
    const { nestedFileRow } = mountTree();
    await handleFileTreeDrop([SOURCE], nestedFileRow);
    expect(importFileMock).toHaveBeenCalledWith(SOURCE, `${NOTES}/paper.md`);
  });

  it("copies into the vault root for a top-level row with no folder ancestor", async () => {
    const { rootFileRow } = mountTree();
    await handleFileTreeDrop([SOURCE], rootFileRow);
    expect(importFileMock).toHaveBeenCalledWith(SOURCE, `${ROOT}/paper.md`);
  });

  it("copies into the vault root when the drop lands on the tree's empty area", async () => {
    const { emptyArea } = mountTree();
    await handleFileTreeDrop([SOURCE], emptyArea);
    expect(importFileMock).toHaveBeenCalledWith(SOURCE, `${ROOT}/paper.md`);
  });

  it("does nothing when no vault is open", async () => {
    useFileStore.setState({ rootPath: null } as never);
    const { folderRow } = mountTree();
    await handleFileTreeDrop([SOURCE], folderRow);
    expect(importFileMock).not.toHaveBeenCalled();
  });
});

describe("handleFileTreeDrop — dropping a folder", () => {
  const FOLDER = "/Users/x/Desktop/notes";

  beforeEach(() => {
    importDirMock.mockReset().mockResolvedValue({
      copied: 3,
      skippedSymlinks: 0,
    });
    // A folder always fails importFile — `import_file` is a single-file copy.
    importFileMock
      .mockReset()
      .mockRejectedValue("Is a directory (os error 21)");
    // listDir is only used for the DESTINATION listing here. It must never be
    // asked about the source — see the regression test at the end of this suite.
    listDirMock.mockReset().mockResolvedValue([]);
    showToastMock.mockReset();
    useFileStore.setState({ rootPath: ROOT, fileTree: [] } as never);
  });

  it("copies the folder into the target directory", async () => {
    const { folderRow } = mountTree();
    await handleFileTreeDrop([FOLDER], folderRow);
    expect(importDirMock).toHaveBeenCalledWith(FOLDER, `${NOTES}/notes`);
  });

  it("adds the folder to the tree as a directory, not a file", async () => {
    // `addFileEntry` inserts into the parent NODE, so the parent has to be in
    // the tree — with an empty fileTree the insert is a silent no-op and the
    // assertion would fail for a reason that has nothing to do with isDir.
    useFileStore.setState({
      rootPath: ROOT,
      fileTree: [{ name: "notes", path: NOTES, isDir: true, children: [] }],
    } as never);

    const { folderRow } = mountTree();
    await handleFileTreeDrop([FOLDER], folderRow);

    const parent = useFileStore
      .getState()
      .fileTree.find((e) => e.path === NOTES);
    const child = parent?.children?.find((c) => c.name === "notes");
    expect(child).toBeDefined();
    expect(child?.isDir).toBe(true);
    expect(child?.path).toBe(`${NOTES}/notes`);
  });

  it("resolves a name conflict instead of merging into the existing folder", async () => {
    // listDir(targetDir) reports an existing `notes`, so the copy must land on
    // a free name — merging would be an irreversible surprise.
    listDirMock.mockImplementation(async (path: string) => {
      if (path === NOTES) return [{ name: "notes", path: `${NOTES}/notes` }];
      return [];
    });
    const { folderRow } = mountTree();
    await handleFileTreeDrop([FOLDER], folderRow);
    const dest = importDirMock.mock.calls.at(-1)?.[1] as string;
    expect(dest).not.toBe(`${NOTES}/notes`);
    expect(dest.startsWith(`${NOTES}/notes`)).toBe(true);
  });

  it("says how many files landed", async () => {
    importDirMock.mockResolvedValue({ copied: 12, skippedSymlinks: 0 });
    const { folderRow } = mountTree();
    await handleFileTreeDrop([FOLDER], folderRow);
    const [message, type] = showToastMock.mock.calls.at(-1) as [string, string];
    expect(message).toContain("12");
    expect(type).toBe("info");
  });

  it("does not report a clean copy when symlinks were skipped", async () => {
    // "copied 12 files" would be true and still misleading: the copy is
    // incomplete, so the skipped count has to reach the user.
    importDirMock.mockResolvedValue({ copied: 12, skippedSymlinks: 2 });
    const { folderRow } = mountTree();
    await handleFileTreeDrop([FOLDER], folderRow);
    const [message, type] = showToastMock.mock.calls.at(-1) as [string, string];
    expect(message).toContain("2");
    expect(type).toBe("warning");
  });

  it("toasts an error when the folder copy itself fails", async () => {
    importDirMock.mockRejectedValue("Destination already exists");
    const { folderRow } = mountTree();
    await handleFileTreeDrop([FOLDER], folderRow);
    expect(showToastMock).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("never asks listDir about the SOURCE path", async () => {
    // The regression that made folder drops fail in the real app while every
    // test stayed green. The source is vault-external by design and `list_dir`
    // is vault-confined, so probing it there reports "not a directory" for
    // every folder a user can drop. Only the DESTINATION may be listed.
    //
    // The old test suite mocked listDir to resolve for any path, so the broken
    // probe looked like it worked; this asserts on the argument instead.
    const { folderRow } = mountTree();
    await handleFileTreeDrop([FOLDER], folderRow);

    const listed = listDirMock.mock.calls.map((c) => c[0] as string);
    expect(listed).not.toContain(FOLDER);
    expect(listed.every((p) => p.startsWith(ROOT))).toBe(true);
  });
});

describe("handleFileTreeDrop — telling the user when it fails", () => {
  beforeEach(() => {
    importDirMock.mockReset();
    importFileMock.mockReset();
    listDirMock.mockReset();
    showToastMock.mockReset();
    useFileStore.setState({ rootPath: ROOT, fileTree: [] } as never);
  });

  it("toasts an error when the copy fails", async () => {
    listDirMock.mockResolvedValue([]);
    importFileMock.mockRejectedValue("copy failed");
    const { folderRow } = mountTree();
    await handleFileTreeDrop([SOURCE], folderRow);
    expect(showToastMock).toHaveBeenCalledWith(expect.any(String), "error");
  });

  it("toasts a plain file failure when import_dir says it was not a directory", async () => {
    // Both runs drop the SAME path, so the two messages share their {name}
    // interpolation and the only thing that can separate them is the template
    // the code picked. An earlier version of this test used a different name
    // per run; the messages then differed for that reason alone and the
    // assertion held even when the branch under test was deleted.
    const DROPPED = "/Users/x/Desktop/thing";
    const { folderRow } = mountTree();
    importFileMock.mockRejectedValue("copy failed");
    listDirMock.mockResolvedValue([]);

    // import_dir copied it ⇒ it was a directory
    importDirMock.mockResolvedValue({ copied: 3, skippedSymlinks: 0 });
    await handleFileTreeDrop([DROPPED], folderRow);
    const folderMessage = showToastMock.mock.calls.at(-1)?.[0] as string;

    // import_dir returned null ⇒ it was a file, so the copy failure stands
    showToastMock.mockReset();
    importDirMock.mockResolvedValue(null);
    await handleFileTreeDrop([DROPPED], folderRow);
    const fileMessage = showToastMock.mock.calls.at(-1)?.[0] as string;

    expect(folderMessage).toBeTruthy();
    expect(fileMessage).toBeTruthy();
    expect(folderMessage).not.toBe(fileMessage);
  });

  it("keeps copying the remaining files after one fails", async () => {
    listDirMock.mockResolvedValue([]);
    importFileMock
      .mockRejectedValueOnce("boom")
      .mockResolvedValueOnce(undefined);
    const { folderRow } = mountTree();
    await handleFileTreeDrop([SOURCE, "/Users/x/Desktop/ok.md"], folderRow);
    expect(importFileMock).toHaveBeenCalledWith(
      "/Users/x/Desktop/ok.md",
      `${NOTES}/ok.md`,
    );
  });
});

// §297 OS 드래그로 들어온 파일을 에디터 본문에 삽입하는 경로. `handleEditorDrop`은
// 모듈-프라이빗이었다가 이 테스트를 위해 export됐다 — 동작 변경은 없다.
describe("handleEditorDrop — routing image vs video (§297)", () => {
  const DOC_PATH = "/vault/notes/today.md";
  const ASSETS_DIR = "/vault/notes/assets";

  function createTestEditor(): Editor {
    return new Editor({ extensions: createBaramExtensions(), content: "" });
  }

  beforeEach(() => {
    importFileMock.mockReset().mockResolvedValue(undefined);
    listDirMock.mockReset().mockResolvedValue([]);
    showToastMock.mockReset();
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: DOC_PATH }],
    } as never);
  });

  it("imports a dropped video as a video node", async () => {
    const editor = createTestEditor();
    await handleEditorDrop(["/Users/x/Desktop/clip.mp4"], editor, 0);

    expect(importFileMock).toHaveBeenCalledWith(
      "/Users/x/Desktop/clip.mp4",
      `${ASSETS_DIR}/clip.mp4`,
    );
    expect(editor.state.doc.firstChild?.type.name).toBe("video");
    expect(editor.state.doc.firstChild?.attrs.src).toBe("assets/clip.mp4");
    editor.destroy();
  });

  it("keeps importing a dropped image as an image node", async () => {
    const editor = createTestEditor();
    await handleEditorDrop(["/Users/x/Desktop/photo.png"], editor, 0);

    expect(importFileMock).toHaveBeenCalledWith(
      "/Users/x/Desktop/photo.png",
      `${ASSETS_DIR}/photo.png`,
    );
    expect(editor.state.doc.firstChild?.type.name).toBe("image");
    expect(editor.state.doc.firstChild?.attrs.src).toBe("assets/photo.png");
    editor.destroy();
  });

  it("routes a mixed drop to the right node type for each file", async () => {
    const editor = createTestEditor();
    await handleEditorDrop(
      ["/Users/x/Desktop/photo.png", "/Users/x/Desktop/clip.mp4"],
      editor,
      0,
    );

    const types: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image" || node.type.name === "video") {
        types.push(node.type.name);
      }
    });
    expect(types).toEqual(["image", "video"]);
    editor.destroy();
  });

  it("toasts a video-specific error when the import fails, but stays silent for an image failure (parity with prior image behaviour)", async () => {
    const editor = createTestEditor();

    importFileMock.mockRejectedValueOnce("disk full");
    await handleEditorDrop(["/Users/x/Desktop/clip.mp4"], editor, 0);
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock.mock.calls[0]?.[1]).toBe("error");

    showToastMock.mockReset();
    importFileMock.mockRejectedValueOnce("disk full");
    await handleEditorDrop(["/Users/x/Desktop/photo.png"], editor, 0);
    expect(showToastMock).not.toHaveBeenCalled();

    editor.destroy();
  });

  it("does nothing when there is no active document path (video or image)", async () => {
    useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
    const editor = createTestEditor();

    await handleEditorDrop(["/Users/x/Desktop/clip.mp4"], editor, 0);

    expect(importFileMock).not.toHaveBeenCalled();
    expect(editor.state.doc.firstChild?.type.name).not.toBe("video");
    editor.destroy();
  });

  // §297 fix (R1): before isMediaFilePath, an unrecognized extension fell
  // through classifyMediaSrc's "image" fallback (correct for markdown
  // `![](…)`, wrong for "is this a real media file") and was copied into
  // assets/ as a broken image node. This app has a PDF viewer, so dropping a
  // PDF is a real user action, not a hypothetical one.
  it("ignores an unrecognized file extension (e.g. a dropped PDF), same as before the mediaSrc-routing regression", async () => {
    const editor = createTestEditor();
    await handleEditorDrop(["/Users/x/Desktop/report.pdf"], editor, 0);

    expect(importFileMock).not.toHaveBeenCalled();
    expect(editor.state.doc.firstChild?.type.name).not.toBe("image");
    expect(editor.state.doc.firstChild?.type.name).not.toBe("video");
    editor.destroy();
  });

  it("still imports the recognized files in a mixed drop that also includes an unrecognized one", async () => {
    const editor = createTestEditor();
    await handleEditorDrop(
      ["/Users/x/Desktop/report.pdf", "/Users/x/Desktop/photo.png"],
      editor,
      0,
    );

    expect(importFileMock).toHaveBeenCalledTimes(1);
    expect(importFileMock).toHaveBeenCalledWith(
      "/Users/x/Desktop/photo.png",
      `${ASSETS_DIR}/photo.png`,
    );
    editor.destroy();
  });

  it("skips a video without throwing when the schema has no video node (e.g. a reduced test schema)", async () => {
    // Mirrors insertMediaAtPos's own defensive guard in drop-handler.ts.
    const editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: "",
    });

    await expect(
      handleEditorDrop(["/Users/x/Desktop/clip.mp4"], editor, 0),
    ).resolves.not.toThrow();
    expect(importFileMock).not.toHaveBeenCalled();
    expect(editor.state.doc.firstChild?.type.name).not.toBe("video");

    editor.destroy();
  });
});

describe("source guard — .file-tree must fill its scroll container", () => {
  // Bound to the `.file-tree` rule itself, not a free-text search of the file:
  // a match anywhere else would not prove the tree fills `.sidebar-content`.
  it("declares min-height on the .file-tree rule", () => {
    const css = readFileSync(
      join(process.cwd(), "src/styles/file-tree.css"),
      "utf8",
    );
    const rules = css.match(/^\.file-tree\s*\{[^}]*\}/gm) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatch(/min-height:\s*100%/);
  });
});

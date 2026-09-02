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

const createDirMock = vi.hoisted(() => vi.fn());
const importDirMock = vi.hoisted(() => vi.fn());
const importFileMock = vi.hoisted(() => vi.fn());
const listDirMock = vi.hoisted(() => vi.fn());
const showToastMock = vi.hoisted(() => vi.fn());
const readMediaDataUrlMock = vi.hoisted(() => vi.fn());

vi.mock("../../ipc/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    ...actual,
    createDir: createDirMock,
    importDir: importDirMock,
    importFile: importFileMock,
    listDir: listDirMock,
    readMediaDataUrl: readMediaDataUrlMock,
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
import {
  handleCaptureDrop,
  handleEditorDrop,
  handleFileTreeDrop,
} from "../use-external-drop";

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
    createDirMock.mockReset().mockResolvedValue(undefined);
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

  // §297 fix (M-9, whole-branch review): this used to no-op with no toast,
  // while the paste path (drop-handler.ts's insertVideoFromBytes) toasts
  // video.noDocumentPath for the exact same condition — same user intent
  // (drop a media file into an unsaved document), two different outcomes
  // depending on which surface it arrived through.
  it("toasts video.noDocumentPath and inserts nothing when there is no active document path", async () => {
    useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
    const editor = createTestEditor();

    await handleEditorDrop(["/Users/x/Desktop/clip.mp4"], editor, 0);

    expect(importFileMock).not.toHaveBeenCalled();
    expect(editor.state.doc.firstChild?.type.name).not.toBe("video");
    expect(showToastMock).toHaveBeenCalledTimes(1);
    const [message, type] = showToastMock.mock.calls[0] as [string, string];
    expect(message).toContain("clip.mp4");
    expect(type).toBe("error");
    editor.destroy();
  });

  it("ignores an unsaved document drop of something that isn't media anyway (M1 parity — no toast, no filesystem call)", async () => {
    useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
    const editor = createTestEditor();

    await handleEditorDrop(["/Users/x/Desktop/report.pdf"], editor, 0);

    expect(importFileMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
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
    // §297 fix (M1): the filter used to live inside the loop below, so even a
    // fully-unrecognized drop still ran createDir(assets/) — leaving a stray
    // empty folder next to the document where before this regression it left
    // nothing on disk at all.
    expect(createDirMock).not.toHaveBeenCalled();
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

// §324-e round 3 — 두 드랍 표면이 갈리는 지점.
//
// 문서 편집기는 즉시 디스크에 쓴다(경로가 있고 상대참조를 걸어 둘 assets/가 있다).
// 캡처 창은 아직 파일이 아니므로 **아무것도 쓰지 않고** data URL로 넣는다. 두
// describe는 한 쌍으로만 뜻이 있다 — 한쪽만 있으면 "전부 즉시 쓴다"거나 "전부
// 미룬다"는 구현도 통과한다.
describe("handleEditorDrop — 문서 편집기는 즉시 쓴다 (§324-e)", () => {
  const DOC_PATH = "/vault/notes/today.md";

  function createTestEditor(): Editor {
    return new Editor({ extensions: createBaramExtensions(), content: "" });
  }

  beforeEach(() => {
    createDirMock.mockReset().mockResolvedValue(undefined);
    importFileMock.mockReset().mockResolvedValue(undefined);
    listDirMock.mockReset().mockResolvedValue([]);
    showToastMock.mockReset();
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: DOC_PATH }],
    } as never);
  });

  it("활성 탭 옆 assets/에 저장한다", async () => {
    const editor = createTestEditor();
    await handleEditorDrop(["/Users/x/Desktop/photo.png"], editor, 0);
    expect(importFileMock).toHaveBeenCalledWith(
      "/Users/x/Desktop/photo.png",
      "/vault/notes/assets/photo.png",
    );
    editor.destroy();
  });

  it("저장되지 않은 문서에서는 쓰지 않고 알린다", async () => {
    useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
    const editor = createTestEditor();
    await handleEditorDrop(["/Users/x/Desktop/photo.png"], editor, 0);
    expect(importFileMock).not.toHaveBeenCalled();
    expect(createDirMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(expect.any(String), "error");
    editor.destroy();
  });

  it("미디어가 아닌 파일은 조용히 무시한다 (M1 동치)", async () => {
    useEditorStore.setState({ activeTabId: null, tabs: [] } as never);
    const editor = createTestEditor();
    await handleEditorDrop(["/Users/x/Desktop/report.pdf"], editor, 0);
    expect(showToastMock).not.toHaveBeenCalled();
    expect(importFileMock).not.toHaveBeenCalled();
    editor.destroy();
  });
});

describe("handleCaptureDrop — 캡처 창은 저장 전까지 쓰지 않는다 (§324-e)", () => {
  const DOC_PATH = "/vault/notes/today.md";
  const PNG_URL = "data:image/png;base64,aGk=";

  function createTestEditor(): Editor {
    return new Editor({ extensions: createBaramExtensions(), content: "" });
  }

  function imageAttrs(editor: Editor): Record<string, unknown>[] {
    const found: Record<string, unknown>[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === "image" || n.type.name === "video")
        found.push(n.attrs);
    });
    return found;
  }

  beforeEach(() => {
    createDirMock.mockReset().mockResolvedValue(undefined);
    importFileMock.mockReset().mockResolvedValue(undefined);
    listDirMock.mockReset().mockResolvedValue([]);
    showToastMock.mockReset();
    readMediaDataUrlMock.mockReset().mockResolvedValue(PNG_URL);
    // 오염원: 캡처와 아무 상관 없는 문서가 메인 창에 열려 있다. 즉시 쓰기가
    // 되살아나면 이미지가 그 문서 옆으로 간다.
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: DOC_PATH }],
    } as never);
  });

  it("디스크에 아무것도 쓰지 않고 data URL 노드를 넣는다", async () => {
    const editor = createTestEditor();
    await handleCaptureDrop(["/Users/x/Desktop/pearl-2.png"], editor, 0);

    expect(importFileMock).not.toHaveBeenCalled();
    expect(createDirMock).not.toHaveBeenCalled();
    expect(readMediaDataUrlMock).toHaveBeenCalledWith(
      "/Users/x/Desktop/pearl-2.png",
    );
    // 원본 이름이 alt로 살아남는다(확장자는 뗀다 — 형제 드랍 경로와 같은 규약이고
    // 사용자가 이미 본 것이다). 추출이 MIME에서 확장자를 되찾는다.
    expect(imageAttrs(editor)).toEqual([
      expect.objectContaining({ alt: "pearl-2", src: PNG_URL }),
    ]);
    editor.destroy();
  });

  it("여러 파일이 서로를 덮지 않고 순서대로 들어간다", async () => {
    readMediaDataUrlMock
      .mockResolvedValueOnce("data:image/png;base64,Zmlyc3Q=")
      .mockResolvedValueOnce("data:image/png;base64,c2Vjb25k");
    const editor = createTestEditor();
    await handleCaptureDrop(
      ["/Users/x/Desktop/a.png", "/Users/x/Desktop/b.png"],
      editor,
      0,
    );
    expect(imageAttrs(editor).map((a) => a.alt)).toEqual(["a", "b"]);
    editor.destroy();
  });

  it("동영상은 video 노드로 들어간다", async () => {
    readMediaDataUrlMock.mockResolvedValue("data:video/mp4;base64,AAAA");
    const editor = createTestEditor();
    await handleCaptureDrop(["/Users/x/Desktop/clip.mp4"], editor, 0);
    const names: string[] = [];
    editor.state.doc.descendants((n) => void names.push(n.type.name));
    expect(names).toContain("video");
    expect(names).not.toContain("image");
    editor.destroy();
  });

  it("미디어가 아닌 파일은 읽지도 않는다", async () => {
    const editor = createTestEditor();
    await handleCaptureDrop(["/Users/x/Desktop/report.pdf"], editor, 0);
    expect(readMediaDataUrlMock).not.toHaveBeenCalled();
    expect(showToastMock).not.toHaveBeenCalled();
    editor.destroy();
  });

  // ‼️ 거절이 조용하면 사용자에게는 "드랍이 안 되는 앱"으로 보인다 — 이 스레드가
  // 계속 고쳐 온 실패 방식이다. 상한 초과는 크기를 말해 주는 **다른** 문구를
  // 받는다: "읽을 수 없습니다"는 고칠 수 있는 상황을 고칠 수 없게 보이게 한다.
  it("상한을 넘으면 크기를 말하는 문구로 거절한다", async () => {
    readMediaDataUrlMock.mockRejectedValue("TOO_LARGE:52428800:26214400");
    const editor = createTestEditor();
    await handleCaptureDrop(["/Users/x/Desktop/huge.png"], editor, 0);

    expect(imageAttrs(editor)).toEqual([]);
    const [message, type] = showToastMock.mock.calls[0] as [string, string];
    expect(type).toBe("error");
    expect(message).toContain("huge.png");
    expect(message).toContain("50");
    expect(message).toContain("25");
    editor.destroy();
  });

  it("읽기가 실패해도 조용히 넘어가지 않고, 나머지 파일은 계속 넣는다", async () => {
    readMediaDataUrlMock
      .mockRejectedValueOnce("nope")
      .mockResolvedValueOnce(PNG_URL);
    const editor = createTestEditor();
    await handleCaptureDrop(
      ["/Users/x/Desktop/bad.png", "/Users/x/Desktop/good.png"],
      editor,
      0,
    );
    expect(showToastMock).toHaveBeenCalledWith(expect.any(String), "error");
    expect(imageAttrs(editor).map((a) => a.alt)).toEqual(["good"]);
    editor.destroy();
  });
});

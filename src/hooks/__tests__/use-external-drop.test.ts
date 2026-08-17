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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const importFileMock = vi.hoisted(() => vi.fn());
const listDirMock = vi.hoisted(() => vi.fn());
const showToastMock = vi.hoisted(() => vi.fn());

vi.mock("../../ipc/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    ...actual,
    createDir: vi.fn(async () => undefined),
    importFile: importFileMock,
    listDir: listDirMock,
  };
});
vi.mock("../../stores/ui/ui", () => ({
  useUIStore: { getState: () => ({ showToast: showToastMock }) },
}));

import { useFileStore } from "../../stores/file/file";
import { handleFileTreeDrop } from "../use-external-drop";

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

describe("handleFileTreeDrop — telling the user when it fails", () => {
  beforeEach(() => {
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

  it("names a dropped FOLDER as the reason, not a generic failure", async () => {
    // `import_file` is a file copy; a directory source rejects. Distinguishing
    // it costs one listDir, and only on the error path.
    //
    // Both runs drop the SAME path, so the two messages share their {name}
    // interpolation and the only thing that can separate them is the template
    // the code picked. An earlier version of this test used a different name
    // per run; the messages then differed for that reason alone and the
    // assertion held even when the folder branch was deleted.
    const DROPPED = "/Users/x/Desktop/thing";
    const { folderRow } = mountTree();
    importFileMock.mockRejectedValue("copy failed");

    // listDir succeeds for the source ⇒ it is a directory
    listDirMock.mockResolvedValue([]);
    await handleFileTreeDrop([DROPPED], folderRow);
    const folderMessage = showToastMock.mock.calls.at(-1)?.[0] as string;

    // listDir rejects for the source ⇒ it is a file
    showToastMock.mockReset();
    listDirMock.mockImplementation(async (path: string) => {
      if (path === DROPPED) throw new Error("not a directory");
      return [];
    });
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

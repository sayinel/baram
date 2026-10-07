// §4.3 New file in the file tree must create, never replace.
//
// `handleConfirmCreate` wrote an empty string to `parent/name` with `writeFile`, which
// replaces whatever is there. Typing a file's exact name emptied it on disk and set its
// open buffer to ""; on a volume that ignores case (the macOS and Windows default) a name
// differing only in case emptied the same file and opened a second tab on it. Nothing
// upstream stopped it: the name input does not check, and blur confirms too. A check
// against the tree would not have caught the case variant — it compares names exactly —
// nor a dot-file it hides. The hook now asks the OS to create the file only if nothing is
// there (`createFile` → Rust `create_file`, `create_new`).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../ipc/invoke")>()),
  createDir: vi.fn(async () => {}),
  createFile: vi.fn(),
  updateFileIndex: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

import {
  createFile,
  FileExistsError,
  updateFileIndex,
  writeFile,
} from "../../../../ipc/invoke";
import { useEditorStore } from "../../../../stores/editor/editor";
import { useFileStore } from "../../../../stores/file/file";
import { findEntryByPath } from "../../../../stores/file/file-tree-ops";
import { useUIStore } from "../../../../stores/ui/ui";
import { useFileTreeCrud } from "../use-file-tree-crud";

const showToast = vi.fn();

beforeEach(() => {
  vi.mocked(createFile).mockReset();
  vi.mocked(writeFile).mockClear();
  vi.mocked(updateFileIndex).mockClear();
  showToast.mockReset();
  useFileStore.setState({
    fileTree: [{ isDir: false, name: "README.md", path: "/vault/README.md" }],
    // The file is open with content the user can see.
    openFiles: new Map([["/vault/README.md", "keep me\n"]]),
    rootPath: "/vault",
  });
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  useUIStore.setState({ showToast });
});

async function createNamed(name: string): Promise<void> {
  const { result } = renderHook(() => useFileTreeCrud());
  act(() => result.current.handleStartCreate("/vault", false));
  await act(() => result.current.handleConfirmCreate(name));
}

describe("a new file in the tree never replaces an existing one", () => {
  it("leaves the open buffer and tabs alone when the exact name is taken, and says so", async () => {
    // The exact name: the old code set THIS buffer to "" — `setFileContent` keys on the
    // exact path, so this is the case where the buffer assertion can fail.
    vi.mocked(createFile).mockRejectedValue(
      new FileExistsError("/vault/README.md"),
    );

    await createNamed("README.md");

    expect(writeFile).not.toHaveBeenCalled();
    expect(useFileStore.getState().openFiles.get("/vault/README.md")).toBe(
      "keep me\n",
    );
    expect(useEditorStore.getState().tabs).toEqual([]);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0]![0]).toContain("README.md");
  });

  it("leaves disk, tree and tabs alone for a name differing only in case, and says so", async () => {
    // What the OS answers for `readme.md` next to `README.md` on a volume that ignores
    // case — the case a name comparison against the tree would have let through. The old
    // code opened a second tab under this spelling and started a second buffer for it.
    vi.mocked(createFile).mockRejectedValue(
      new FileExistsError("/vault/readme.md"),
    );

    await createNamed("readme.md");

    expect(writeFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs).toEqual([]);
    expect(useFileStore.getState().openFiles.has("/vault/readme.md")).toBe(
      false,
    );
    expect(
      findEntryByPath(useFileStore.getState().fileTree, "/vault/readme.md"),
    ).toBeNull();
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, type] = showToast.mock.calls[0]!;
    expect(message).toContain("readme.md");
    expect(type).toBe("error");
  });

  it("does not call any other failure a taken name", async () => {
    // Only the ALREADY_EXISTS refusal is the user's to fix by renaming; a permission or
    // I/O failure must not be reported as one. It goes to the log as before, and nothing
    // local pretends the file was made.
    vi.mocked(createFile).mockRejectedValue(
      "파일 읽기 실패: permission denied",
    );

    await createNamed("new.md");

    expect(showToast).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs).toEqual([]);
    expect(
      findEntryByPath(useFileStore.getState().fileTree, "/vault/new.md"),
    ).toBeNull();
  });

  it("CONTROL: a free name is created empty, added to the tree and opened", async () => {
    vi.mocked(createFile).mockResolvedValue(undefined);

    await createNamed("new.md");

    expect(createFile).toHaveBeenCalledWith("/vault/new.md", "");
    expect(writeFile).not.toHaveBeenCalled();
    expect(
      findEntryByPath(useFileStore.getState().fileTree, "/vault/new.md"),
    ).not.toBeNull();
    expect(useEditorStore.getState().tabs).toMatchObject([
      { filePath: "/vault/new.md" },
    ]);
    expect(useFileStore.getState().openFiles.get("/vault/new.md")).toBe("");
    expect(showToast).not.toHaveBeenCalled();
  });

  // §29 issue 790 — the watcher skips the app's own `file:created` and the
  // graph no longer rebuilds per save, so the new note joins the index here.
  // 이것을 실패시키는 것: `handleConfirmCreate` 의 `updateFileIndex(fullPath)` 호출을 지운다.
  it("indexes the new note once, and an existing name not at all", async () => {
    vi.mocked(createFile).mockResolvedValue(undefined);
    await createNamed("new.md");
    expect(updateFileIndex).toHaveBeenCalledTimes(1);
    expect(updateFileIndex).toHaveBeenCalledWith("/vault/new.md");

    vi.mocked(createFile).mockRejectedValue(
      new FileExistsError("/vault/README.md"),
    );
    await createNamed("README.md");
    expect(updateFileIndex).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: `isMarkdownNote(fullPath)` 관문을 지운다 — `update_file_index` 가
  // `paper.pdf` 를 내용 "" 의 노트로 등록한다.
  it("does not index a non-markdown file as a note", async () => {
    vi.mocked(createFile).mockResolvedValue(undefined);
    await createNamed("paper.pdf");
    expect(createFile).toHaveBeenCalledWith("/vault/paper.pdf", "");
    expect(updateFileIndex).not.toHaveBeenCalled();
  });
});

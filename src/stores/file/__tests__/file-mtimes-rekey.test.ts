// §3.5 rename · move 는 원문과 함께 수정 시각 기록의 key 도 옮긴다 (#798).
//
// 옛 key 에 남은 기록은 닫힌 탭의 release 가 새 경로로 찾지 못해 세션 내내 남는다. 폴더를 옮기면
// 그 아래 열린 파일마다 하나씩이다. 순서는 앱의 것을 따른다 — rename 은 use-file-tree-rename.ts 의
// `renameFileEntry` → `renameDirInTabs`, move 는 use-file-tree-move.ts 의 hook 을 그대로 돈다.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  renameFile: async () => undefined,
}));

import { useFileTreeMove } from "../../../components/sidebar/hooks/use-file-tree-move";
import { startClosedTabRelease } from "../../editor/closed-tab-release";
import { useEditorStore } from "../../editor/editor";
import { useFileStore } from "../file";

let stop: () => void = () => undefined;

function keys() {
  const { fileMtimes, openFiles } = useFileStore.getState();
  return { mtimes: [...fileMtimes.keys()], files: [...openFiles.keys()] };
}

function open(id: string, filePath: string) {
  useFileStore.getState().setFileContent(filePath, id);
  useFileStore.getState().initFileMtime(filePath);
  useEditorStore.getState().openTab({
    contextId: "",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: id,
    type: "file",
  });
}

beforeEach(() => {
  useFileStore.setState({
    fileMtimes: new Map(),
    fileTree: [
      {
        children: [
          { isDir: false, name: "x.md", path: "/v/d/x.md" },
          { isDir: false, name: "y.md", path: "/v/d/y.md" },
        ],
        isDir: true,
        name: "d",
        path: "/v/d",
      },
      { children: [], isDir: true, name: "dest", path: "/v/dest" },
    ],
    openFiles: new Map(),
    rootPath: "/v",
  });
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
  stop = startClosedTabRelease();
  open("x", "/v/d/x.md");
  open("y", "/v/d/y.md");
});

afterEach(() => stop());

// 이것을 실패시키는 것: file.ts 의 renameFileEntry · moveFileEntry 에서 `fileMtimes:` 줄을 지우면
// 옛 key 의 기록이 남아 두 시험이 깨진다.
describe("§3.5 rename and move carry the mtime record (#798)", () => {
  it("renaming a folder moves every descendant's record, and closing releases them", () => {
    useFileStore.getState().renameFileEntry("/v/d", "/v/e", "e");
    useEditorStore.getState().renameDirInTabs("/v/d", "/v/e");
    expect(keys()).toEqual({
      files: ["/v/e/x.md", "/v/e/y.md"],
      mtimes: ["/v/e/x.md", "/v/e/y.md"],
    });

    useEditorStore.getState().closeAllTabs();
    expect(keys()).toEqual({ files: [], mtimes: [] });
  });

  it("moving a folder through the file tree's move hook does the same", async () => {
    const { result } = renderHook(() => useFileTreeMove());
    await act(async () => {
      await result.current.moveEntries(["/v/d"], "/v/dest");
    });
    expect(keys().mtimes).toEqual(["/v/dest/d/x.md", "/v/dest/d/y.md"]);

    useEditorStore.getState().closeAllTabs();
    expect(keys()).toEqual({ files: [], mtimes: [] });
  });
});

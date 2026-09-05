// §82 실앱 보고: "소스 모드에서 고쳐 dirty가 뜬 뒤 저장해도 dirty가 안 사라진다".
//
// ‼️ `sourceEditedTabs`의 해제 지점을 셋으로 열거했다 — 탭 닫힘, WYSIWYG 토글 복귀,
// 닫기 관문의 `saveDirtyTab`. 그런데 **사용자가 가장 자주 쓰는 경로인 Cmd+S**(`handleSave`)를
// 빠뜨렸다. 파일은 제대로 써지고 `isDirty`도 내려가는데 이 플래그만 남아, 점이 계속 켜져 있고
// 닫을 때마다 확인창이 떴다.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (_path: string, _content: string) => {});

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useFileOperations } from "../use-file-operations";

const PATH = "/v/note.md";
const TAB = "t1";
const EDITED = "typed in source mode\n";

beforeEach(() => {
  writeFile.mockClear();
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [],
    sourceEditedTabs: [TAB],
    sourceModeTabs: [TAB],
    tabs: [
      {
        contextId: "c",
        filePath: PATH,
        id: TAB,
        isDirty: true,
        isPinned: false,
        title: "note.md",
        type: "file",
      },
    ],
  } as never);
});

describe("handleSave on a markdown tab edited in source mode", () => {
  it("writes the buffer AND clears the source-edited flag", async () => {
    const editor = new Editor({ extensions: createBaramExtensions() });
    const ops = renderHook(() =>
      useFileOperations({
        editor,
        getSourceBuffer: () => EDITED,
        sourceModeTabs: new Set([TAB]),
      }),
    );

    await act(async () => {
      await ops.result.current.handleSave();
    });

    expect(writeFile).toHaveBeenCalledWith(PATH, EDITED);
    // Both halves of "unsaved" must come down. Clearing only `isDirty` leaves the
    // tab marked and re-prompts on every close.
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
    expect(useEditorStore.getState().sourceEditedTabs).toEqual([]);

    ops.unmount();
    editor.destroy();
  });
});

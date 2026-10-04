/*
 * §3.6 `handleSave` 의 쓰기 뒤 순서 — 플러그인은 cache 와 flag 가 "저장됨" 을 말한 뒤에
 * `file:save` 를 듣는다.
 *
 * 쓰기 뒤 회계를 `noteTabWritten`·`announceTabWrite` 로 나눴다. 둘을 하나로 묶으면
 * `file:save` 가 `setFileContent`·`markDirty` 앞으로 끌려와, 저장 알림을 받은 플러그인이
 * 낡은 캐시와 dirty 탭을 본다. 이 테스트는 알림 시점의 상태를 잡아 그 순서를 고정한다.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (_path: string, _content: string) => {});
const seenAtFileSave: { dirty?: boolean; openFile?: string }[] = [];

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

vi.mock("../../plugins/plugin-lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/plugin-lifecycle")>()),
  notifyFileSave: (path: string) => {
    seenAtFileSave.push({
      dirty: useEditorStore.getState().tabs.find((t) => t.filePath === path)
        ?.isDirty,
      openFile: useFileStore.getState().openFiles.get(path),
    });
  },
}));

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { useFileOperations } from "../../hooks/use-file-operations";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";

const PATH = "/v/a.md";

beforeEach(() => {
  writeFile.mockClear();
  seenAtFileSave.length = 0;
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([[PATH, "old\n"]]),
  });
  useEditorStore.setState({
    activeTabId: "a",
    mruOrder: [],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    tabs: [
      {
        contextId: "c",
        filePath: PATH,
        id: "a",
        isDirty: true,
        isPinned: false,
        title: "a.md",
      },
    ],
  });
});

describe("§3.6 handleSave announces the write after the cache and flags agree", () => {
  it("a file:save listener sees the saved text in openFiles and a clean tab", async () => {
    // 이것을 실패시키는 것: `handleSave` 에서 `announceTabWrite` 를 `setFileContent` 앞으로 옮김.
    const editor = makeTestEditor("<p>saved body</p>");
    const ops = renderHook(() =>
      useFileOperations({
        editor,
        getSourceBuffer: () => "",
        sourceModeTabs: new Set(),
      }),
    );

    await act(async () => {
      await ops.result.current.handleSave();
    });

    const written = writeFile.mock.calls.at(-1)?.[1];
    expect(written).toContain("saved body");
    expect(seenAtFileSave).toEqual([{ dirty: false, openFile: written }]);
    ops.unmount();
    editor.destroy();
  });
});

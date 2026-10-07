// §3.6 issue 795 — applying a conflict merge writes the merged text, and puts it in
// the tab that asked only while that tab still shows the file and holds what it held.
import type { Editor } from "@tiptap/core";

import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writes: Array<(mtime: number) => void> = [];
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  writeFile: vi.fn(
    () => new Promise<number>((resolve) => writes.push(resolve)),
  ),
}));

import type { EditorTab } from "../../../stores/editor/editor";

import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { applyConflictMerge } from "../apply-conflict-merge";

const NOTE = "/v/a.md";
const OTHER = "/v/b.md";

/** An editor whose document is a plain object we can swap to stand for typing. */
function fakeEditor(): { editor: Editor; type: () => void } {
  const state = { doc: { id: 1 } };
  const editor = { isDestroyed: false, state } as unknown as Editor;
  return { editor, type: () => (state.doc = { id: state.doc.id + 1 }) };
}

function refreshes(): number {
  return useEditorStore.getState().contentRefreshKey;
}

beforeEach(() => {
  writes.length = 0;
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([[NOTE, "local"]]),
  });
  useEditorStore.setState({
    activeTabId: "t1",
    contentRefreshKey: 0,
    tabs: [
      { filePath: NOTE, id: "t1", isDirty: true, title: "a" },
      { filePath: OTHER, id: "t2", isDirty: true, title: "b" },
    ] as EditorTab[],
  });
});

async function finish(apply: Promise<void>, mtime = 77): Promise<void> {
  writes.shift()?.(mtime);
  await act(async () => {
    await apply;
  });
}

describe("applyConflictMerge", () => {
  // 위의 두 경우가 "아무것도 안 해서" 가 아님을 보인다.
  it("refreshes the conflicted tab and marks it clean when nothing moved", async () => {
    const { editor } = fakeEditor();
    const markDirty = vi.fn();
    await finish(applyConflictMerge(NOTE, "merged", editor, markDirty));
    expect(refreshes()).toBe(1);
    expect(useEditorStore.getState().contentRefreshPath).toBe(NOTE);
    expect(markDirty).toHaveBeenCalledWith("t1", false);
    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("merged");
    expect(useFileStore.getState().getFileMtime(NOTE)?.lastSaveMtime).toBe(77);
  });

  // 이것을 실패시키는 것: 쓰기 뒤에 편집기 문서가 그대로인지(`docAtApply`) 확인하지 않는다.
  it("keeps the tab dirty and its text when the user typed during the write", async () => {
    const { editor, type } = fakeEditor();
    const markDirty = vi.fn();
    const apply = applyConflictMerge(NOTE, "merged", editor, markDirty);
    type();
    await finish(apply);
    expect(markDirty).not.toHaveBeenCalled();
    expect(refreshes()).toBe(0);
    // The file and its baseline still follow the merge.
    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("merged");
  });

  // 이것을 실패시키는 것: 쓰기 뒤의 활성 탭을 그대로 깨끗하다고 표시한다(이 이슈 전의 코드).
  it("leaves another tab untouched when the user switched during the write", async () => {
    const { editor } = fakeEditor();
    const markDirty = vi.fn();
    const apply = applyConflictMerge(NOTE, "merged", editor, markDirty);
    act(() => useEditorStore.getState().setActiveTab("t2"));
    await finish(apply);
    expect(markDirty).not.toHaveBeenCalled();
    expect(refreshes()).toBe(0);
  });
});

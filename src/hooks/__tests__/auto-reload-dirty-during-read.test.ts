// §3.2 issue 795 — `triggerAutoReload` starts on a clean tab and awaits the read. If the
// user types meanwhile, applying the read would rebuild the editor from it ("fresh"
// refresh) and drop what was typed. The reload stands down and asks with the conflict
// modal instead, its base the cache from before the read.
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads: Array<(content: string) => void> = [];
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: vi.fn(() => new Promise<string>((resolve) => reads.push(resolve))),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { triggerAutoReload } from "../use-file-operations";

const NOTE = "/v/a.md";

function refreshes(): number {
  return useEditorStore.getState().contentRefreshKey;
}

beforeEach(() => {
  reads.length = 0;
  useUIStore.setState({ conflictModal: null });
  useFileStore.setState({
    fileMtimes: new Map([[NOTE, { canReloadMtime: 0, lastSaveMtime: 0 }]]),
    openFiles: new Map([[NOTE, "before"]]),
  });
  useEditorStore.setState({
    activeTabId: "t1",
    contentRefreshKey: 0,
    tabs: [
      { filePath: NOTE, id: "t1", isDirty: false, title: "a" } as EditorTab,
    ],
  });
});

describe("an auto-reload whose tab turned dirty during the read", () => {
  // 이것을 실패시키는 것: triggerAutoReload 의 읽기 뒤 dirty 재확인을 지운다.
  it("applies nothing and opens the conflict modal once, based on the cache before the read", async () => {
    const reload = triggerAutoReload(NOTE, 42);
    act(() => useEditorStore.getState().markDirty("t1", true));
    reads.shift()?.("from disk");
    await act(async () => {
      await reload;
    });
    expect(refreshes()).toBe(0);
    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("before");
    expect(useUIStore.getState().conflictModal).toEqual({
      base: "before",
      externalMtime: 42,
      filePath: NOTE,
    });
  });

  // 위의 0 이 리로드가 아무것도 안 해서가 아님을 보인다 — 깨끗한 채로 끝나면 적용한다.
  it("applies the read when the tab stayed clean", async () => {
    const reload = triggerAutoReload(NOTE, 42);
    reads.shift()?.("from disk");
    await act(async () => {
      await reload;
    });
    expect(refreshes()).toBe(1);
    expect(useFileStore.getState().openFiles.get(NOTE)).toBe("from disk");
    expect(useUIStore.getState().conflictModal).toBeNull();
  });

  // 이것을 실패시키는 것: dirty 재확인이 `options.force` 를 보지 않는다(충돌 모달의 "Reload" 가 막힌다).
  it("still applies when the user chose to discard local edits", async () => {
    act(() => useEditorStore.getState().markDirty("t1", true));
    const reload = triggerAutoReload(NOTE, 42, { force: true });
    reads.shift()?.("from disk");
    await act(async () => {
      await reload;
    });
    expect(refreshes()).toBe(1);
    expect(useUIStore.getState().conflictModal).toBeNull();
  });
});

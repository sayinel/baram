/*
 * §3.6 소스 모드에서 친 글자도 "저장 안 된 작업" 이다 — 외부 변경이 그것을 덮으면 안 된다.
 *
 * 마크다운 소스 모드의 타이핑은 `isDirty` 를 켜지 않고 `sourceEditedTabs` 를 세운다
 * (`tab-surface-renderers.tsx`). 외부 변경을 처리하는 세 자리(워처, keepalive 재개,
 * 자동 리로드의 stale 표시)가 `isDirty` 하나만 보면 그 탭은 clean 으로 읽혀 충돌 모달
 * 없이 자동 리로드로 간다. 정답 함수는 `isTabUnsaved` 다.
 *
 * 장면: a 는 소스 모드 배경 탭이다. sourceEdited 이고 `isDirty` 는 false 다. 버퍼와
 * `openFiles` 가 둘 다 "A src edit" 이다 — 버퍼가 캐시와 같아 `syncSourceBuffers` 의
 * 갈라짐 판정만으로는 지켜지지 않는 경우다.
 */
import type { EditorTab } from "../../stores/editor/editor";
import type { TabSwitchContext } from "../tab-switching/types";

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ChangedHandler = (e: {
  payload: { mtime: number; origin?: string; path: string };
}) => void;
let onFileChanged: ChangedHandler | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: unknown) => {
    if (name === "file:changed") onFileChanged = handler as ChangedHandler;
    return Promise.resolve(() => undefined);
  },
}));

const readFile = vi.fn(async (_path: string) => "EXTERNAL\n");

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => readFile(path),
  watchDir: () => Promise.resolve(),
}));

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { resumeKeepaliveTab } from "../tab-switching/resume-keepalive-tab";
import { triggerAutoReload } from "../use-file-operations";
import { useFileWatcher } from "../use-file-watcher";

const A = "/v/a.md";
const B = "/v/b.md";
const EDIT = "A src edit\n";

const buffers = new Map<string, string>();

const tab = (id: string, filePath: string): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

beforeEach(() => {
  buffers.clear();
  buffers.set("a", EDIT);
  readFile.mockClear();
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useFileStore.getState().setFileContent(A, EDIT);
  useFileStore.getState().setFileContent(B, "B\n");
  useFileStore.getState().updateLastSaveMtime(A, 1000);
  useUIStore.getState().dismissToast();
  useUIStore.setState({ conflictQueue: [] });
  useEditorStore.setState({
    activeTabId: "b",
    mruOrder: [],
    sourceBufferAccess: {
      getSourceBuffer: (id) => buffers.get(id) ?? "",
      setSourceBuffer: (id, content) => {
        buffers.set(id, content);
      },
    },
    sourceEditedTabs: ["a"],
    sourceModeTabs: ["a"],
    staleContentTabs: [],
    tabs: [tab("a", A), tab("b", B)],
  });
});

afterEach(() => {
  onFileChanged = null;
});

describe("§3.6 a source-edited tab is unsaved when its file changes on disk", () => {
  it("the watcher raises a conflict instead of auto-reloading over the buffer", async () => {
    // 이것을 실패시키는 것: 워처 판정을 `tab.isDirty` 로 되돌림(자동 리로드가 버퍼를 덮는다).
    renderHook(() => useFileWatcher());
    await waitFor(() => expect(onFileChanged).not.toBeNull());

    onFileChanged!({ payload: { mtime: 2000, origin: "external", path: A } });
    await Promise.resolve();

    expect(useUIStore.getState().conflictQueue).toMatchObject([
      { filePath: A, tabId: "a" },
    ]);
    expect(readFile).not.toHaveBeenCalled();
    expect(buffers.get("a")).toBe(EDIT);
  });

  it("resuming a keepalive tab raises a conflict for a source-edited tab", async () => {
    // 이것을 실패시키는 것: `resume-keepalive-tab.ts` 의 판정을 `incomingTab.isDirty` 로 되돌림.
    useFileStore.getState().updateCanReloadMtime(A, 2000);
    useEditorStore.setState({ activeTabId: "a" });
    const editor = makeTestEditor("<p>A src edit</p>");
    const ctx = {
      installContent: () => undefined,
      onActiveEditorChange: () => undefined,
      scrollOffsets: { current: new Map<string, number>() },
    } as unknown as TabSwitchContext;

    resumeKeepaliveTab(ctx, "a", editor, tab("a", A));

    expect(useUIStore.getState().conflictQueue).toMatchObject([
      { filePath: A, tabId: "a" },
    ]);
    expect(readFile).not.toHaveBeenCalled();
    // 재개가 예약한 `requestAnimationFrame` 스크롤 복원이 돈 뒤에 부순다.
    await new Promise((resolve) => setTimeout(resolve, 30));
    editor.destroy();
  });

  it("a direct auto-reload keeps the source-edited buffer and warns", async () => {
    // 이것을 실패시키는 것: `syncSourceBuffers` 의 `sourceEditedTabs` 조건 제거(버퍼가 캐시와
    // 같아 갈라짐 판정이 지켜 주지 못한다).
    await triggerAutoReload(A, 2000);

    expect(buffers.get("a")).toBe(EDIT);
    expect(useUIStore.getState().toast?.type).toBe("warning");
  });

  it("a direct auto-reload does not mark the source-edited background tab stale", async () => {
    // 이것을 실패시키는 것: stale 건너뛰기를 `t.isDirty` 로 되돌림(복원이 그 편집을 버린다).
    await triggerAutoReload(A, 2000);

    expect(useEditorStore.getState().staleContentTabs).not.toContain("a");
  });
});

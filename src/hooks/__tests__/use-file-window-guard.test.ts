// §89 A file window answers for itself when it is closed.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  awaitBlockIdRenames: vi.fn(async () => undefined),
  close: null as
    ((event: { preventDefault: () => void }) => Promise<void>) | null,
  reportRequest: null as (() => void) | null,
  reportSaveResult: vi.fn(async () => undefined),
  reportUnsaved: vi.fn(async () => undefined),
  saveRequest: null as (() => void) | null,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (
      handler: (event: { preventDefault: () => void }) => Promise<void>,
    ) => {
      host.close = handler;
      return () => {};
    },
  }),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    listen: async (_name: string, handler: () => void) => {
      host.saveRequest = handler;
      return () => {};
    },
  }),
}));

vi.mock("../../utils/editor/block-id-rename-landing", () => ({
  awaitBlockIdRenames: host.awaitBlockIdRenames,
}));

vi.mock("../../services/file-windows", () => ({
  onReportRequest: async (report: () => void) => {
    host.reportRequest = report;
    return () => {};
  },
  reportSaveResult: host.reportSaveResult,
  reportUnsaved: host.reportUnsaved,
  SAVE_REQUEST: "file-window://save",
}));

import type { EditorTab } from "../../stores/editor/editor";

import { useEditorStore } from "../../stores/editor/editor";
import { useUIStore } from "../../stores/ui/ui";
import { useFileWindowGuard } from "../use-file-window-guard";

const TAB = "file-editor-1";

async function close(): Promise<ReturnType<typeof vi.fn>> {
  await vi.waitFor(() => expect(host.close).not.toBeNull());
  const preventDefault = vi.fn();
  await host.close?.({ preventDefault });
  return preventDefault;
}

function show(over: Partial<EditorTab> = {}, sourceEditedTabs: string[] = []) {
  useEditorStore.setState({
    activeTabId: TAB,
    sourceEditedTabs,
    tabs: [
      {
        contextId: "",
        filePath: "/v/note.md",
        id: TAB,
        isDirty: false,
        isPinned: false,
        title: "note.md",
        ...over,
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  host.close = null;
  host.reportRequest = null;
  host.saveRequest = null;
  useUIStore.setState({ unsavedModal: null });
  show();
});

describe("closing the window", () => {
  // 이것을 실패시키는 것: 판정을 지우면 저장하지 않은 글을 둔 채 창이 사라진다.
  it("holds the close and asks when the tab has unsaved work", async () => {
    show({ isDirty: true });
    renderHook(() => useFileWindowGuard(TAB, true, vi.fn()));

    const preventDefault = await close();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "closeWindow",
      tabId: TAB,
    });
  });

  // 이것을 실패시키는 것: 기다리지 않으면, 곧 착지할 블록 ID 변경이 올리는 표시를 보지 못하고 닫는다.
  it("decides after a block ID rename still landing has landed", async () => {
    host.awaitBlockIdRenames.mockImplementationOnce(async () => {
      useEditorStore.getState().markDirty(TAB, true);
    });
    renderHook(() => useFileWindowGuard(TAB, false, vi.fn()));

    const preventDefault = await close();

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  // 이것을 실패시키는 것: `isDirty` 만 보면 소스 모드 편집을 묻지 않고 닫는다.
  it("counts an edit made in source mode", async () => {
    show({}, [TAB]);
    renderHook(() => useFileWindowGuard(TAB, true, vi.fn()));

    const preventDefault = await close();

    expect(preventDefault).toHaveBeenCalledOnce();
  });

  // The pair.
  it("lets a clean window close", async () => {
    renderHook(() => useFileWindowGuard(TAB, false, vi.fn()));

    const preventDefault = await close();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(useUIStore.getState().unsavedModal).toBeNull();
  });

  it("lets a window close before its file has loaded", async () => {
    renderHook(() => useFileWindowGuard(null, false, vi.fn()));

    const preventDefault = await close();

    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("telling the main window", () => {
  it("reports when the answer changes", () => {
    const hook = renderHook(
      ({ unsaved }) => useFileWindowGuard(TAB, unsaved, vi.fn()),
      { initialProps: { unsaved: false } },
    );
    expect(host.reportUnsaved).toHaveBeenLastCalledWith(false);

    hook.rerender({ unsaved: true });

    expect(host.reportUnsaved).toHaveBeenLastCalledWith(true);
  });

  it("reports the current answer when a reloaded main window asks", async () => {
    renderHook(() => useFileWindowGuard(TAB, true, vi.fn()));
    await vi.waitFor(() => expect(host.reportRequest).not.toBeNull());
    host.reportUnsaved.mockClear();

    host.reportRequest?.();

    expect(host.reportUnsaved).toHaveBeenCalledWith(true);
  });

  it("saves when asked, and says it did", async () => {
    show({ isDirty: true });
    const handleSave = vi.fn(async () => {
      useEditorStore.getState().markDirty(TAB, false);
    });
    renderHook(() => useFileWindowGuard(TAB, true, handleSave));
    await vi.waitFor(() => expect(host.saveRequest).not.toBeNull());

    host.saveRequest?.();

    await vi.waitFor(() =>
      expect(host.reportSaveResult).toHaveBeenCalledWith(true),
    );
    expect(handleSave).toHaveBeenCalledOnce();
  });

  // 이것을 실패시키는 것: 저장 실패를 성공으로 알리면 main 창이 그대로 프로세스를 끝낸다.
  it("says so when the save left the tab unsaved", async () => {
    show({ isDirty: true });
    renderHook(() =>
      useFileWindowGuard(
        TAB,
        true,
        vi.fn(async () => {}),
      ),
    );
    await vi.waitFor(() => expect(host.saveRequest).not.toBeNull());

    host.saveRequest?.();

    await vi.waitFor(() =>
      expect(host.reportSaveResult).toHaveBeenCalledWith(false),
    );
  });
});

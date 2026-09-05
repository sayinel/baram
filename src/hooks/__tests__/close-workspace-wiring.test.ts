// §81 실앱 보고 재현: "dirty 상태에서 워크스페이스를 닫으면 확인창 없이 그대로 닫힌다".
//
// ‼️ 관문(`requestCloseWorkspace`)과 모달은 각각 테스트가 있었지만, **메뉴가 누르는 것은
// `handleCloseFolder`**이고 그 둘을 잇는 한 줄에는 아무 단정도 없었다. 그 줄을 예전처럼
// `useFileStore.getState().closeFolder()`로 되돌려도 스위트는 전부 초록이었다 — 사용자는
// 저장 안 된 문서를 잃는데.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/context")>();
  return { ...actual, removeContext: vi.fn(async () => undefined) };
});

import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { useFileOperations } from "../use-file-operations";

const PATH = "/v/a.md";

function mountOps() {
  return renderHook(() =>
    useFileOperations({
      editor: null,
      getSourceBuffer: () => "",
      sourceModeTabs: new Set(),
    }),
  );
}

function openTab(over: Record<string, unknown> = {}) {
  useEditorStore.setState({
    activeTabId: "t1",
    mruOrder: ["t1"],
    sourceEditedTabs: [],
    tabs: [
      {
        contextId: "c",
        filePath: PATH,
        id: "t1",
        isDirty: false,
        isPinned: false,
        title: "a.md",
        type: "file",
        ...over,
      },
    ],
  } as never);
}

beforeEach(() => {
  useUIStore.setState({ unsavedModal: null });
  useFileStore.setState({ rootPath: "/v" } as never);
  useContextStore.setState({
    activeContextId: "c",
    contexts: [
      {
        id: "c",
        addedAt: 0,
        color: "#fff",
        contextType: "vault",
        label: "v",
        path: "/v",
      },
    ],
  } as never);
});

describe("handleCloseFolder — the half the menu actually calls", () => {
  it("asks first when a tab is dirty, and closes nothing yet", async () => {
    openTab({ isDirty: true });
    const ops = mountOps();

    await act(async () => {
      ops.result.current.handleCloseFolder();
    });

    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "closeWorkspace",
    });
    expect(useFileStore.getState().rootPath).toBe("/v");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
    ops.unmount();
  });

  it("asks first for a tab edited only in SOURCE MODE, which never went dirty", async () => {
    openTab();
    useEditorStore.setState({ sourceEditedTabs: ["t1"] });
    const ops = mountOps();

    await act(async () => {
      ops.result.current.handleCloseFolder();
    });

    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "closeWorkspace",
    });
    expect(useFileStore.getState().rootPath).toBe("/v");
    ops.unmount();
  });

  it("closes straight away when nothing is unsaved", async () => {
    openTab();
    const ops = mountOps();

    await act(async () => {
      ops.result.current.handleCloseFolder();
    });

    expect(useUIStore.getState().unsavedModal).toBeNull();
    expect(useFileStore.getState().rootPath).toBeNull();
    ops.unmount();
  });
});

// §82 "이 탭은 저장 안 된 작업을 들고 있는가"의 답은 두 곳에 산다 — `isDirty`와
// `sourceEditedTabs`다. 닫기 관문만 둘 다 읽고 나머지는 `isDirty`만 읽으면, 소스 모드로
// 고치던 탭이 **점도 안 뜨고** 탭 X로 조용히 사라진다. 실앱에서 그렇게 보고됐다.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/vault-context-loader", () => ({
  switchContext: vi.fn(async () => undefined),
}));

// jsdom has no ResizeObserver; TabBar's overflow-scroll effect constructs one.
globalThis.ResizeObserver = class {
  disconnect() {}
  observe() {}
  unobserve() {}
} as unknown as typeof ResizeObserver;

import type { EditorTab } from "../../../stores/editor/editor";

import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useUIStore } from "../../../stores/ui/ui";
import { TabBar } from "../TabBar";

function tab(over: Partial<EditorTab> = {}): EditorTab {
  return {
    contextId: "ctx",
    filePath: "/v/note.md",
    id: "t1",
    isDirty: false,
    isPinned: false,
    title: "note.md",
    type: "file",
    ...over,
  };
}

beforeEach(() => {
  useUIStore.setState({ unsavedModal: null });
  useContextStore.setState({ activeContextId: "ctx", contexts: [] } as never);
  useEditorStore.setState({
    activeTabId: "t1",
    mruOrder: ["t1"],
    sourceEditedTabs: [],
    tabs: [tab()],
  });
});

/** The dirty marker the tab title carries (U+25CF). */
function titleOf(name: string): string {
  return screen.getByText(new RegExp(name)).textContent ?? "";
}

describe("TabBar — unsaved indicator", () => {
  it("marks a tab edited in source mode, which never sets isDirty", () => {
    useEditorStore.setState({ sourceEditedTabs: ["t1"] });

    render(<TabBar />);

    // Markdown typed in source mode deliberately does not raise `isDirty`
    // (§312), so a dot driven by `isDirty` alone leaves the user with no sign
    // that the file has unsaved text in it.
    expect(titleOf("note.md")).toContain("●");
  });

  it("still marks an ordinary dirty tab", () => {
    useEditorStore.setState({ tabs: [tab({ isDirty: true })] });

    render(<TabBar />);

    expect(titleOf("note.md")).toContain("●");
  });

  it("leaves a genuinely clean tab unmarked", () => {
    render(<TabBar />);

    expect(titleOf("note.md")).not.toContain("●");
  });
});

describe("TabBar — closing one tab", () => {
  it("asks before dropping a tab edited in source mode", () => {
    useEditorStore.setState({ sourceEditedTabs: ["t1"] });
    const closeTab = vi.fn();
    useEditorStore.setState({ closeTab } as never);

    render(<TabBar />);
    fireEvent.click(screen.getByTitle("Close tab"));

    expect(useUIStore.getState().unsavedModal).toEqual({
      intent: "closeTab",
      tabId: "t1",
    });
    expect(closeTab).not.toHaveBeenCalled();
  });

  it("closes a clean tab without asking", () => {
    const closeTab = vi.fn();
    useEditorStore.setState({ closeTab } as never);

    render(<TabBar />);
    fireEvent.click(screen.getByTitle("Close tab"));

    expect(useUIStore.getState().unsavedModal).toBeNull();
    expect(closeTab).toHaveBeenCalledWith("t1");
  });
});

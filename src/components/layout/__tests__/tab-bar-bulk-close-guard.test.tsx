// §38 탭 메뉴의 "다른 탭 닫기" · "오른쪽 탭 닫기" 도 저장하지 않은 탭을 먼저 묻는다 (#798).
//
// 예전에는 store action 을 바로 불러 배경의 dirty 탭을 말없이 닫았다. 닫힌 탭의 release 는 그
// 탭의 원문 · source buffer 를 내려놓으므로, 묻지 않으면 저장하지 않은 편집의 마지막 사본이 사라진다.
// 메뉴 클릭부터 modal 의 세 버튼까지 실제 컴포넌트로 돈다.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.fn(async (_path: string, _content: string) => undefined);

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  updateFileIndex: async () => undefined,
  writeFile: (path: string, content: string) => writeFile(path, content),
}));
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
import { startClosedTabRelease } from "../../../stores/editor/closed-tab-release";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { UnsavedChangesModal } from "../../editor/UnsavedChangesModal";
import { TabBar } from "../TabBar";

let stop: () => void = () => undefined;

async function choose(menuItem: string) {
  fireEvent.contextMenu(screen.getByText("a.md"));
  await act(async () => {
    fireEvent.click(screen.getByText(menuItem));
  });
}

function ids() {
  return useEditorStore.getState().tabs.map((t) => t.id);
}

async function press(button: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: button }));
  });
}

function tab(id: string, isDirty = false): EditorTab {
  return {
    contextId: "ctx",
    filePath: `/v/${id}.md`,
    id,
    isDirty,
    isPinned: false,
    title: `${id}.md`,
    type: "file",
  };
}

beforeEach(() => {
  writeFile.mockClear();
  useUIStore.setState({ unsavedModal: null });
  useContextStore.setState({ activeContextId: "ctx", contexts: [] } as never);
  // a 가 활성, b 는 저장하지 않은 배경 탭, c 는 깨끗한 배경 탭. 모두 a 의 오른쪽에 있다.
  useEditorStore.setState({
    activeTabId: "a",
    mruOrder: ["a", "b", "c"],
    sourceEditedTabs: [],
    tabs: [tab("a"), tab("b", true), tab("c")],
  });
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([
      ["/v/a.md", "a"],
      ["/v/b.md", "UNSAVED EDIT"],
      ["/v/c.md", "c"],
    ]),
  });
  stop = startClosedTabRelease();
  render(
    <>
      <TabBar />
      <UnsavedChangesModal handleSave={vi.fn(async () => undefined)} />
    </>,
  );
});

afterEach(() => stop());

// 이것을 실패시키는 것: TabBar 의 메뉴 항목을 store 의 `closeOtherTabs(tab.id)` ·
// `closeTabsToRight(tab.id)` 로 되돌리면 modal 없이 b 가 닫혀 원문이 사라진다.
describe("§38 bulk tab close asks about unsaved tabs first (#798)", () => {
  it.each(["Close Other Tabs", "Close Tabs to the Right"])(
    "%s asks, and keeps everything until the user answers",
    async (item) => {
      await choose(item);

      expect(useUIStore.getState().unsavedModal).toMatchObject({
        intent: "closeTabs",
        tabIds: ["b", "c"],
      });
      expect(ids()).toEqual(["a", "b", "c"]);
      expect(useFileStore.getState().openFiles.get("/v/b.md")).toBe(
        "UNSAVED EDIT",
      );

      await press("Cancel");
      expect(ids()).toEqual(["a", "b", "c"]);
      expect(useFileStore.getState().openFiles.get("/v/b.md")).toBe(
        "UNSAVED EDIT",
      );
    },
  );

  it("Don't Save closes the listed tabs and releases them", async () => {
    await choose("Close Other Tabs");
    await press("Don't Save");

    expect(ids()).toEqual(["a"]);
    expect(writeFile).not.toHaveBeenCalled();
    expect([...useFileStore.getState().openFiles.keys()]).toEqual(["/v/a.md"]);
  });

  it("Save writes the unsaved text first, then closes and releases", async () => {
    await choose("Close Other Tabs");
    await press("Save & Close Tabs");

    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      "/v/b.md",
      "UNSAVED EDIT",
    );
    expect(ids()).toEqual(["a"]);
    expect([...useFileStore.getState().openFiles.keys()]).toEqual(["/v/a.md"]);
  });

  // 이것을 실패시키는 것: UnsavedChangesModal 의 `scopedTabIds` 거르기를 빼면 남는 a 까지 세어 2 가 된다.
  it("counts only the unsaved tabs it is about to close", async () => {
    useEditorStore.setState({
      tabs: [tab("a", true), tab("b", true), tab("c")],
    });
    await choose("Close Other Tabs");

    expect(
      screen.getByText(
        "Closing these tabs discards 1 document(s) with unsaved changes.",
      ),
    ).toBeTruthy();
  });

  it("closes clean tabs straight away", async () => {
    // 긍정 짝 — 저장할 것이 없으면 묻지 않는다.
    useEditorStore.setState({ tabs: [tab("a"), tab("b"), tab("c")] });
    await choose("Close Tabs to the Right");

    expect(useUIStore.getState().unsavedModal).toBeNull();
    expect(ids()).toEqual(["a"]);
  });
});

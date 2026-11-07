// §89 Tearing a tab off opens its file in a new window and closes the tab. The window reads the
// disk, so whatever is not on disk goes with the tab.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/vault-context-loader", () => ({
  switchContext: vi.fn(async () => undefined),
}));

const openFileWindow = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../../../utils/file-window", () => ({ openFileWindow }));

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

function show(over: Partial<EditorTab>, sourceEditedTabs: string[] = []) {
  useEditorStore.setState({
    activeTabId: "t1",
    mruOrder: ["t1"],
    sourceEditedTabs,
    tabs: [
      {
        contextId: "ctx",
        filePath: "/v/note.md",
        id: "t1",
        isDirty: false,
        isPinned: false,
        title: "note.md",
        type: "file",
        ...over,
      },
    ],
  });
}

/** Press on the tab and let go far below the bar, past both the drag and the tear-off distance. */
function dragOut(title: string) {
  fireEvent.mouseDown(screen.getByText(title), { button: 0, clientX: 10 });
  fireEvent.mouseMove(document, { clientX: 100, clientY: 300 });
  fireEvent.mouseUp(document, { clientX: 100, clientY: 300 });
}

beforeEach(() => {
  openFileWindow.mockClear();
  useUIStore.setState({ toast: null, unsavedModal: null });
  useContextStore.setState({ activeContextId: "ctx", contexts: [] } as never);
});

describe("tearing a tab off", () => {
  function letGoAfter(change: () => void) {
    fireEvent.mouseDown(screen.getByText("note.md"), {
      button: 0,
      clientX: 10,
    });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 300 });
    act(change);
    fireEvent.mouseUp(document, { clientX: 100, clientY: 300 });
  }

  // 이것을 실패시키는 것: 드래그를 시작할 때의 탭으로 판정하면 그사이 생긴 글을 묻지 않고 버린다.
  it("reads the tab as it is when let go", async () => {
    show({});
    render(<TabBar />);

    letGoAfter(() => useEditorStore.getState().markDirty("t1", true));

    await waitFor(() =>
      expect(useUIStore.getState().toast?.message).toBe(
        "Save this tab before moving it to its own window.",
      ),
    );
    expect(openFileWindow).not.toHaveBeenCalled();
  });

  // 이것을 실패시키는 것: 창을 여는 동안 생긴 글을 다시 보지 않으면 묻지 않고 닫는다.
  it("keeps the tab if it gained work while the window opened", async () => {
    show({});
    openFileWindow.mockImplementationOnce(async () => {
      useEditorStore.getState().markDirty("t1", true);
    });
    render(<TabBar />);

    dragOut("note.md");

    await waitFor(() => expect(openFileWindow).toHaveBeenCalledOnce());
    await act(async () => {
      await Promise.resolve();
    });
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it("lets it go if it was saved during the drag", async () => {
    show({ isDirty: true });
    render(<TabBar />);

    letGoAfter(() => useEditorStore.getState().markDirty("t1", false));

    await waitFor(() =>
      expect(openFileWindow).toHaveBeenCalledWith("/v/note.md"),
    );
  });

  // The pair: a tab whose text is on disk moves to its window.
  it("moves a saved tab to a window of its own", async () => {
    show({});
    render(<TabBar />);

    dragOut("note.md");

    await waitFor(() =>
      expect(openFileWindow).toHaveBeenCalledWith("/v/note.md"),
    );
    await waitFor(() => expect(useEditorStore.getState().tabs).toEqual([]));
  });

  // 이것을 실패시키는 것: `isTabUnsaved` 검사를 지우면 저장하지 않은 글을 묻지 않고 버린다.
  it.each<[string, Partial<EditorTab>, string[]]>([
    ["with unsaved changes", { isDirty: true }, []],
    ["edited in source mode", {}, ["t1"]],
    ["with no file", { filePath: "", title: "Untitled" }, []],
  ])("refuses a tab %s and keeps it", async (_name, over, edited) => {
    show(over, edited);
    render(<TabBar />);

    dragOut(over.title ?? "note.md");

    await waitFor(() =>
      expect(useUIStore.getState().toast?.message).toBe(
        "Save this tab before moving it to its own window.",
      ),
    );
    expect(openFileWindow).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });
});

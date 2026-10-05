// §39 MRU (Most Recently Used) tab order tests
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../editor/editor";

beforeEach(() => {
  useEditorStore.setState({
    activeTabId: null,
    tabs: [],
    mruOrder: [],
  });
});

describe("MRU Tab Order", () => {
  it("touchMru moves tabId to front of mruOrder", () => {
    useEditorStore.setState({ mruOrder: ["a", "b", "c"] });
    useEditorStore.getState().touchMru("c");
    expect(useEditorStore.getState().mruOrder).toEqual(["c", "a", "b"]);
  });

  it("touchMru adds new tabId to front", () => {
    useEditorStore.setState({ mruOrder: ["a", "b"] });
    useEditorStore.getState().touchMru("d");
    expect(useEditorStore.getState().mruOrder).toEqual(["d", "a", "b"]);
  });

  it("touchMru on empty list creates single-element list", () => {
    useEditorStore.getState().touchMru("x");
    expect(useEditorStore.getState().mruOrder).toEqual(["x"]);
  });

  it("touchMru does not duplicate", () => {
    useEditorStore.setState({ mruOrder: ["a", "b", "c"] });
    useEditorStore.getState().touchMru("a");
    expect(useEditorStore.getState().mruOrder).toEqual(["a", "b", "c"]);
  });

  it("getNextMruTab returns next tab in MRU order (forward)", () => {
    useEditorStore.setState({ mruOrder: ["a", "b", "c"] });
    expect(useEditorStore.getState().getNextMruTab("a", "forward")).toBe("b");
    expect(useEditorStore.getState().getNextMruTab("b", "forward")).toBe("c");
  });

  it("getNextMruTab wraps around at end (forward)", () => {
    useEditorStore.setState({ mruOrder: ["a", "b", "c"] });
    expect(useEditorStore.getState().getNextMruTab("c", "forward")).toBe("a");
  });

  it("getNextMruTab returns previous tab in MRU order (backward)", () => {
    useEditorStore.setState({ mruOrder: ["a", "b", "c"] });
    expect(useEditorStore.getState().getNextMruTab("b", "backward")).toBe("a");
    expect(useEditorStore.getState().getNextMruTab("c", "backward")).toBe("b");
  });

  it("getNextMruTab wraps around at start (backward)", () => {
    useEditorStore.setState({ mruOrder: ["a", "b", "c"] });
    expect(useEditorStore.getState().getNextMruTab("a", "backward")).toBe("c");
  });

  it("getNextMruTab returns null with single tab", () => {
    useEditorStore.setState({ mruOrder: ["a"] });
    expect(useEditorStore.getState().getNextMruTab("a", "forward")).toBeNull();
  });

  it("getNextMruTab returns null with empty list", () => {
    expect(useEditorStore.getState().getNextMruTab("a", "forward")).toBeNull();
  });

  it("closeTab removes tabId from mruOrder", () => {
    useEditorStore.setState({
      tabs: [
        {
          contextId: "",
          id: "a",
          filePath: "a.md",
          title: "A",
          isDirty: false,
          isPinned: false,
        },
        {
          contextId: "",
          id: "b",
          filePath: "b.md",
          title: "B",
          isDirty: false,
          isPinned: false,
        },
      ],
      activeTabId: "a",
      mruOrder: ["a", "b"],
    });
    useEditorStore.getState().closeTab("b");
    expect(useEditorStore.getState().mruOrder).toEqual(["a"]);
  });

  it("openTab adds new tab to mruOrder front", () => {
    useEditorStore.setState({ mruOrder: ["a"] });
    useEditorStore.getState().openTab({
      contextId: "",
      id: "b",
      filePath: "b.md",
      title: "B",
      isDirty: false,
      isPinned: false,
    });
    expect(useEditorStore.getState().mruOrder).toEqual(["b", "a"]);
  });
});

// §81 A tab opened for later — a space's note at launch, while the restore decides
// what is on screen.
describe("openTab with activate: false", () => {
  const tab = (id: string, filePath: string) => ({
    contextId: "ctx",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: id,
  });

  it("adds the tab behind the active one, at the back of the MRU order", () => {
    useEditorStore.getState().openTab(tab("a", "a.md"));

    useEditorStore.getState().openTab(tab("b", "b.md"), { activate: false });

    const { activeTabId, mruOrder, tabs } = useEditorStore.getState();
    expect(tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(activeTabId).toBe("a");
    expect(mruOrder).toEqual(["a", "b"]);
  });

  it("leaves an already-open file exactly as it is", () => {
    useEditorStore.getState().openTab(tab("a", "a.md"));
    useEditorStore.getState().openTab(tab("b", "b.md"));
    const before = useEditorStore.getState();

    useEditorStore.getState().openTab(tab("c", "a.md"), { activate: false });

    expect(useEditorStore.getState()).toBe(before);
  });
});

import type { EditorTab } from "../editor/editor";

// Phase 1: conflictState field and setConflictState/resolveConflict methods
import { beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../editor/editor";

const makeTab = (id: string, isDirty = false): EditorTab => ({
  contextId: "",
  id,
  filePath: `/${id}.md`,
  title: id,
  isDirty,
  isPinned: false,
});

beforeEach(() => {
  useEditorStore.setState({
    activeTabId: null,
    tabs: [],
    mruOrder: [],
  });
});

describe("setConflictState", () => {
  it("sets conflictState on the target tab", () => {
    useEditorStore.setState({ tabs: [makeTab("t1", true)] });
    useEditorStore.getState().setConflictState("t1", {
      filePath: "/t1.md",
      externalMtime: 5000,
      localLastSaveMtime: 3000,
      action: "pending",
    });
    const tab = useEditorStore.getState().tabs.find((t) => t.id === "t1");
    expect(tab?.conflictState).toEqual({
      filePath: "/t1.md",
      externalMtime: 5000,
      localLastSaveMtime: 3000,
      action: "pending",
    });
  });

  it("clears conflictState when passed undefined", () => {
    useEditorStore.setState({
      tabs: [
        {
          ...makeTab("t1"),
          conflictState: {
            filePath: "/t1.md",
            externalMtime: 5000,
            localLastSaveMtime: 3000,
            action: "pending",
          },
        },
      ],
    });
    useEditorStore.getState().setConflictState("t1", undefined);
    const tab = useEditorStore.getState().tabs.find((t) => t.id === "t1");
    expect(tab?.conflictState).toBeUndefined();
  });

  it("does not affect other tabs", () => {
    useEditorStore.setState({ tabs: [makeTab("t1"), makeTab("t2")] });
    useEditorStore.getState().setConflictState("t1", {
      filePath: "/t1.md",
      externalMtime: 1,
      localLastSaveMtime: 0,
      action: "pending",
    });
    const t2 = useEditorStore.getState().tabs.find((t) => t.id === "t2");
    expect(t2?.conflictState).toBeUndefined();
  });
});

describe("resolveConflict — reload", () => {
  it("clears conflictState so caller can reload content", () => {
    useEditorStore.setState({
      tabs: [
        {
          ...makeTab("t1", true),
          conflictState: {
            filePath: "/t1.md",
            externalMtime: 5000,
            localLastSaveMtime: 3000,
            action: "pending",
          },
        },
      ],
    });
    useEditorStore.getState().resolveConflict("t1", "reload");
    const tab = useEditorStore.getState().tabs.find((t) => t.id === "t1");
    expect(tab?.conflictState).toBeUndefined();
  });
});

describe("resolveConflict — keep", () => {
  it("marks conflictState as resolved without clearing it", () => {
    useEditorStore.setState({
      tabs: [
        {
          ...makeTab("t1", true),
          conflictState: {
            filePath: "/t1.md",
            externalMtime: 5000,
            localLastSaveMtime: 3000,
            action: "pending",
          },
        },
      ],
    });
    useEditorStore.getState().resolveConflict("t1", "keep");
    const tab = useEditorStore.getState().tabs.find((t) => t.id === "t1");
    expect(tab?.conflictState?.action).toBe("resolved");
    // Other fields preserved
    expect(tab?.conflictState?.externalMtime).toBe(5000);
    expect(tab?.conflictState?.localLastSaveMtime).toBe(3000);
  });
});

describe("resolveConflict — no-op when tab has no conflictState", () => {
  it("leaves the tab unchanged if there is no conflict to resolve", () => {
    useEditorStore.setState({ tabs: [makeTab("t1")] });
    useEditorStore.getState().resolveConflict("t1", "reload");
    const tab = useEditorStore.getState().tabs.find((t) => t.id === "t1");
    expect(tab?.conflictState).toBeUndefined();
  });
});

describe("resolveConflict — unknown tabId", () => {
  it("does not throw and leaves tabs unchanged", () => {
    useEditorStore.setState({ tabs: [makeTab("t1")] });
    expect(() =>
      useEditorStore.getState().resolveConflict("does-not-exist", "reload"),
    ).not.toThrow();
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });
});

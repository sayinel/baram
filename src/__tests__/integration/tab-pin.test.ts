// §38 Integration: Tab Pin — pin/unpin, close protection, reorder boundary, context menu actions
import { beforeEach, describe, expect, it } from "vitest";

import { type EditorTab, useEditorStore } from "../../stores/editor/editor";

function makeTab(id: string, filePath: string): EditorTab {
  return {
    id,
    contextId: "",
    filePath,
    title: filePath.split("/").pop() || id,
    isDirty: false,
    isPinned: false,
  };
}

describe("§38 Tab Pin", () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeTabId: null,
      tabs: [],
      mruOrder: [],
    });
  });

  it("pinTab sets isPinned=true and moves to end of pinned group", () => {
    const { openTab, pinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));
    openTab(makeTab("t3", "/c.md"));

    // Pin t3 (currently last)
    pinTab("t3");
    let tabs = useEditorStore.getState().tabs;
    expect(tabs[0].id).toBe("t3");
    expect(tabs[0].isPinned).toBe(true);

    // Pin t2 — should go to end of pinned group (after t3)
    useEditorStore.getState().pinTab("t2");
    tabs = useEditorStore.getState().tabs;
    expect(tabs[0].id).toBe("t3");
    expect(tabs[1].id).toBe("t2");
    expect(tabs[1].isPinned).toBe(true);
    expect(tabs[2].id).toBe("t1");
    expect(tabs[2].isPinned).toBe(false);
  });

  it("unpinTab sets isPinned=false and moves to start of unpinned group", () => {
    const { openTab, pinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));
    openTab(makeTab("t3", "/c.md"));

    pinTab("t1");
    pinTab("t2");

    // Unpin t1 — should move to start of unpinned group
    useEditorStore.getState().unpinTab("t1");
    const tabs = useEditorStore.getState().tabs;
    expect(tabs[0].id).toBe("t2"); // still pinned
    expect(tabs[0].isPinned).toBe(true);
    expect(tabs[1].id).toBe("t1"); // just unpinned, at start of unpinned
    expect(tabs[1].isPinned).toBe(false);
    expect(tabs[2].id).toBe("t3");
  });

  it("togglePinTab toggles pin state", () => {
    const { openTab, togglePinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));

    togglePinTab("t1");
    expect(useEditorStore.getState().tabs[0].isPinned).toBe(true);

    useEditorStore.getState().togglePinTab("t1");
    expect(useEditorStore.getState().tabs[0].isPinned).toBe(false);
  });

  it("closeTab does NOT close pinned tabs", () => {
    const { openTab, pinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));

    pinTab("t1");
    // Try to close pinned tab
    useEditorStore.getState().closeTab("t1");

    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs.find((t) => t.id === "t1")).toBeDefined();
  });

  it("closeTab still closes unpinned tabs", () => {
    const { openTab, closeTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));

    closeTab("t2");
    expect(useEditorStore.getState().tabs).toHaveLength(1);
  });

  it("closeOtherTabs preserves pinned tabs and the given tab", () => {
    const { openTab, pinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));
    openTab(makeTab("t3", "/c.md"));
    openTab(makeTab("t4", "/d.md"));

    pinTab("t1");

    // Close others relative to t3 — should keep t1 (pinned) and t3
    useEditorStore.getState().closeOtherTabs("t3");
    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("closeTabsToRight preserves pinned tabs to the right", () => {
    const { openTab, pinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));
    openTab(makeTab("t3", "/c.md"));
    openTab(makeTab("t4", "/d.md"));

    // Pin t1 and t4
    pinTab("t1");
    pinTab("t4");

    // State: [t1(pinned), t4(pinned), t2, t3]
    // Close tabs to the right of t2 (index=2) — should close t3 but keep t4 (pinned)
    useEditorStore.getState().closeTabsToRight("t2");
    const tabs = useEditorStore.getState().tabs;
    const ids = tabs.map((t) => t.id);
    expect(ids).toContain("t1");
    expect(ids).toContain("t4");
    expect(ids).toContain("t2");
    expect(ids).not.toContain("t3");
  });

  it("reorderTab clamps pinned tabs within pinned boundary", () => {
    const { openTab, pinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));
    openTab(makeTab("t3", "/c.md"));

    pinTab("t1");
    // State: [t1(pinned), t2, t3]

    // Try to reorder pinned t1 to index 2 (unpinned zone) — should be clamped
    useEditorStore.getState().reorderTab(0, 2);
    const tabs = useEditorStore.getState().tabs;
    expect(tabs[0].id).toBe("t1"); // stays at 0 (only pinned slot)
  });

  it("reorderTab clamps unpinned tabs within unpinned boundary", () => {
    const { openTab, pinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));
    openTab(makeTab("t3", "/c.md"));

    pinTab("t1");
    // State: [t1(pinned), t2, t3]

    // Try to reorder t2 (index 1) to index 0 (pinned zone) — should be clamped
    useEditorStore.getState().reorderTab(1, 0);
    const tabs = useEditorStore.getState().tabs;
    expect(tabs[0].id).toBe("t1"); // pinned stays
    expect(tabs[1].id).toBe("t2"); // clamped to pinnedCount=1
  });

  it("reorderTab allows reordering within same group", () => {
    const { openTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));
    openTab(makeTab("t3", "/c.md"));

    // All unpinned: reorder t1 to index 2
    useEditorStore.getState().reorderTab(0, 2);
    const tabs = useEditorStore.getState().tabs;
    expect(tabs.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("new tabs always open as unpinned", () => {
    const { openTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    expect(useEditorStore.getState().tabs[0].isPinned).toBe(false);
  });

  it("MRU order works independently of pin state", () => {
    const { openTab, pinTab, touchMru } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));
    openTab(makeTab("t3", "/c.md"));

    pinTab("t1");

    // MRU: [t3, t2, t1] — pin doesn't change MRU
    touchMru("t1");
    // MRU: [t1, t3, t2]
    const next = useEditorStore.getState().getNextMruTab("t1", "forward");
    expect(next).toBe("t3");
  });

  it("pinning already-pinned tab is a no-op", () => {
    const { openTab, pinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    pinTab("t1");
    const before = useEditorStore.getState().tabs;

    useEditorStore.getState().pinTab("t1");
    const after = useEditorStore.getState().tabs;
    expect(after).toEqual(before);
  });

  it("unpinning already-unpinned tab is a no-op", () => {
    const { openTab, unpinTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    const before = useEditorStore.getState().tabs;

    unpinTab("t1");
    const after = useEditorStore.getState().tabs;
    expect(after).toEqual(before);
  });

  it("closeOtherTabs updates activeTabId if active tab is closed", () => {
    const { openTab, setActiveTab } = useEditorStore.getState();
    openTab(makeTab("t1", "/a.md"));
    openTab(makeTab("t2", "/b.md"));
    openTab(makeTab("t3", "/c.md"));

    setActiveTab("t2");

    // Close others relative to t1 — t2 is active but will be closed
    useEditorStore.getState().closeOtherTabs("t1");
    expect(useEditorStore.getState().activeTabId).toBe("t1");
  });
});

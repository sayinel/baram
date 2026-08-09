// §69 — the plugin detail tab. A THIRD tab type after "file" and "graph", so the
// assertions below are as much about what a non-file tab must NOT acquire (a dirty
// flag, a file path, a save path) as about the payload it carries.
import { beforeEach, describe, expect, it } from "vitest";

import { isFileTab, isGraphTab, isPluginTab, useEditorStore } from "../editor";

beforeEach(() => {
  useEditorStore.setState({ tabs: [], activeTabId: null, mruOrder: [] });
});

describe("openPluginTab (§69)", () => {
  it("opens a plugin tab carrying the plugin id and no file path", () => {
    useEditorStore.getState().openPluginTab("baram-word-count", "Word Count");

    const { tabs, activeTabId } = useEditorStore.getState();
    expect(tabs).toHaveLength(1);
    const tab = tabs[0]!;
    expect(tab.type).toBe("plugin");
    expect(tab.pluginId).toBe("baram-word-count");
    expect(tab.title).toBe("Word Count");
    // ‼️ An empty filePath is what keeps this tab out of every file code path. A
    // plugin id parked in `filePath` would be read as a path by the save and
    // switching logic.
    expect(tab.filePath).toBe("");
    expect(tab.isDirty).toBe(false);
    expect(activeTabId).toBe(tab.id);
  });

  it("is a singleton PER PLUGIN — reopening activates rather than duplicates", () => {
    const store = useEditorStore.getState();
    store.openPluginTab("a", "A");
    const firstId = useEditorStore.getState().activeTabId;
    store.openPluginTab("b", "B");
    store.openPluginTab("a", "A");

    const { tabs, activeTabId } = useEditorStore.getState();
    // Two plugins, two tabs — a shared singleton (the graph-tab rule) would have
    // collapsed these into one and shown the wrong plugin.
    expect(tabs).toHaveLength(2);
    expect(activeTabId).toBe(firstId);
  });

  it("does not collide with the graph tab", () => {
    const store = useEditorStore.getState();
    store.openGraphTab();
    store.openPluginTab("a", "A");

    const { tabs } = useEditorStore.getState();
    expect(tabs).toHaveLength(2);
    expect(tabs.filter((t) => isGraphTab(t))).toHaveLength(1);
    expect(tabs.filter((t) => isPluginTab(t))).toHaveLength(1);
  });
});

describe("tab-type predicates", () => {
  it("classifies a plugin tab as neither file nor graph", () => {
    useEditorStore.getState().openPluginTab("a", "A");
    const tab = useEditorStore.getState().tabs[0];

    expect(isPluginTab(tab)).toBe(true);
    // The whole read-only story rests on this: every save/dirty/source-mode guard
    // asks `isFileTab`.
    expect(isFileTab(tab)).toBe(false);
    expect(isGraphTab(tab)).toBe(false);
  });

  it("still treats a typeless tab as a file tab (persisted-shape compat)", () => {
    const legacy = {
      contextId: "",
      filePath: "/a.md",
      id: "1",
      isDirty: false,
      isPinned: false,
      title: "a.md",
    };
    expect(isFileTab(legacy)).toBe(true);
    expect(isPluginTab(legacy)).toBe(false);
  });
});

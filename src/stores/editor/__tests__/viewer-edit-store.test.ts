// §392 spec 0071 — what the editor store does for an editable viewer: refuse to lower dirty over
// a change no read has taken (D15), hold the preview ↔ source set (D16 · §7.4), and take a
// pending change before a path change (§6.6).
import type { ViewerEditMount } from "../../../plugins/viewer-edit-mounts";
import type { EditorTab } from "../editor";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerViewerEditMount,
  unregisterViewerEditMount,
} from "../../../plugins/viewer-edit-mounts";
import { flushViewerEdits, useEditorStore } from "../editor";

const tab = (id: string, filePath: string, isDirty = false): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty,
  isPinned: false,
  title: id,
});

const mounts: ViewerEditMount[] = [];
function viewerMount(tabId: string, pending = true): ViewerEditMount {
  const m: ViewerEditMount = {
    deliver: () => {},
    el: document.createElement("div"),
    filePath: "",
    getText: () => "",
    pending,
    pluginId: "sketch",
    tabId,
    viewerId: "sketch:pad",
  };
  registerViewerEditMount(m);
  mounts.push(m);
  return m;
}

/** Every read the store asks of the source buffer, with the tab's path at that moment. */
const reads: { path: string | undefined; tabId: string }[] = [];

beforeEach(() => {
  reads.length = 0;
  useEditorStore.setState({
    activeTabId: "a",
    mruOrder: ["a", "b", "c"],
    previewSourceTabs: [],
    sourceBufferAccess: {
      getSourceBuffer: (id) => {
        reads.push({
          path: useEditorStore.getState().tabs.find((t) => t.id === id)
            ?.filePath,
          tabId: id,
        });
        return "";
      },
      setSourceBuffer: () => {},
    },
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [
      tab("a", "/v/a.strokes", true),
      tab("b", "/v/dir/b.strokes", true),
      tab("c", "/v/c.txt", true),
    ],
  });
});
afterEach(() => {
  for (const m of mounts.splice(0)) unregisterViewerEditMount(m);
  useEditorStore.setState({ sourceBufferAccess: null });
});

const dirtyOf = (id: string) =>
  useEditorStore.getState().tabs.find((t) => t.id === id)?.isDirty;

describe("D15 — markDirty(false) over an untaken viewer change", () => {
  it("is refused while the tab's viewer holds a change no read has taken, and wakes nobody", () => {
    viewerMount("a");
    const before = useEditorStore.getState();
    const listener = vi.fn();
    const unsubscribe = useEditorStore.subscribe(listener);
    useEditorStore.getState().markDirty("a", false);
    unsubscribe();
    expect(dirtyOf("a")).toBe(true);
    expect(useEditorStore.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("goes through once the change was taken (the positive half)", () => {
    const m = viewerMount("a");
    m.pending = false;
    useEditorStore.getState().markDirty("a", false);
    expect(dirtyOf("a")).toBe(false);
  });

  it("does not touch another tab, nor markDirty(true)", () => {
    viewerMount("a");
    useEditorStore.getState().markDirty("c", false);
    expect(dirtyOf("c")).toBe(false);
    useEditorStore.setState({ tabs: [tab("a", "/v/a.strokes", false)] });
    useEditorStore.getState().markDirty("a", true);
    expect(dirtyOf("a")).toBe(true);
  });
});

describe("previewSourceTabs (§6.6 · §7.4)", () => {
  it("turns a tab on and off", () => {
    const { setPreviewSourceForTab } = useEditorStore.getState();
    setPreviewSourceForTab("a", true);
    expect(useEditorStore.getState().previewSourceTabs).toEqual(["a"]);
    setPreviewSourceForTab("a", false);
    expect(useEditorStore.getState().previewSourceTabs).toEqual([]);
  });

  it("setting the state it already has wakes no subscriber", () => {
    useEditorStore.getState().setPreviewSourceForTab("a", true);
    const listener = vi.fn();
    const unsubscribe = useEditorStore.subscribe(listener);
    useEditorStore.getState().setPreviewSourceForTab("a", true);
    useEditorStore.getState().setPreviewSourceForTab("never-on", false);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ["closeTab", () => useEditorStore.getState().closeTab("a")],
    ["closeOtherTabs", () => useEditorStore.getState().closeOtherTabs("c")],
    ["closeTabsToRight", () => useEditorStore.getState().closeTabsToRight("c")],
    [
      "closeTabsForContexts",
      () => useEditorStore.getState().closeTabsForContexts(new Set(["c"])),
    ],
    ["closeAllTabs", () => useEditorStore.getState().closeAllTabs()],
  ] as const)("%s drops the ids of the tabs it closed", (name, close) => {
    // closeTabsToRight("c") closes nothing ("c" is last) — the positive control that the set
    // keeps an open tab's id.
    useEditorStore.setState({ previewSourceTabs: ["a", "c"] });
    close();
    const open = new Set(useEditorStore.getState().tabs.map((t) => t.id));
    const kept = useEditorStore.getState().previewSourceTabs;
    expect(
      kept.every((id) => open.has(id)),
      name,
    ).toBe(true);
    if (name === "closeTabsToRight") expect(kept).toEqual(["a", "c"]);
    else expect(kept).not.toContain("a");
  });
});

describe("flushViewerEdits (§6.6 · §7.2)", () => {
  it("reads only the tabs whose viewer holds a change that the predicate selects", () => {
    viewerMount("a");
    viewerMount("b");
    viewerMount("c", false);
    flushViewerEdits((m) => m.tabId !== "b");
    expect(reads.map((r) => r.tabId)).toEqual(["a"]);
  });

  it("skips a tab that is already closed", () => {
    viewerMount("gone");
    flushViewerEdits(() => true);
    expect(reads).toEqual([]);
  });

  it("does nothing without a registered buffer access", () => {
    viewerMount("a");
    useEditorStore.setState({ sourceBufferAccess: null });
    expect(() => flushViewerEdits(() => true)).not.toThrow();
  });
});

describe("a path change takes the change first (§6.6 · §7.1)", () => {
  it("renameTab reads the tab while it still has its old path, then moves it", () => {
    viewerMount("a");
    useEditorStore.getState().renameTab("/v/a.strokes", "/v/a.txt", "a.txt");
    expect(reads).toEqual([{ path: "/v/a.strokes", tabId: "a" }]);
    expect(useEditorStore.getState().tabs[0].filePath).toBe("/v/a.txt");
  });

  it("renameTab reads nothing when no viewer holds a change", () => {
    viewerMount("a", false);
    useEditorStore.getState().renameTab("/v/a.strokes", "/v/a.txt", "a.txt");
    expect(reads).toEqual([]);
  });

  it("renameDirInTabs reads the tabs under the directory, before the move", () => {
    viewerMount("a");
    viewerMount("b");
    useEditorStore.getState().renameDirInTabs("/v/dir", "/v/moved");
    expect(reads).toEqual([{ path: "/v/dir/b.strokes", tabId: "b" }]);
    expect(useEditorStore.getState().tabs[1].filePath).toBe(
      "/v/moved/b.strokes",
    );
  });
});

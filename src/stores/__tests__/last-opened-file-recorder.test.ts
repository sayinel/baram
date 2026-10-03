// §81 `lastOpenedFile` and the recent-files list follow the active file tab.
//
// Before, only `openFileByPath` set them to a file, and most other openers — the file
// tree, the quick switcher, search, backlinks, the graph, the calendar, … — reach the
// editor through `openTab`, directly or through `openFileInTab`. A file opened any of
// those ways was never recorded, and "Restore last file" reopened whatever
// `openFileByPath` last saw.
import type { EditorTab } from "../editor/editor";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useEditorStore } from "../editor/editor";
import { startLastOpenedFileRecorder } from "../editor/last-opened-file";
import { useSettingsStore } from "../settings/store";

function fileTab(id: string, filePath: string): EditorTab {
  return {
    contextId: "ctx",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: filePath.split("/").pop() ?? "",
  };
}

let stop: () => void = () => {};

beforeEach(() => {
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
  useSettingsStore.setState({ lastOpenedFile: null, recentFiles: [] });
  stop = startLastOpenedFileRecorder();
});

afterEach(() => stop());

const lastOpened = () => useSettingsStore.getState().lastOpenedFile;
const recentPaths = () =>
  useSettingsStore.getState().recentFiles.map((f) => f.path);

describe("§81 last-opened-file recorder", () => {
  it("records a file opened through openTab, as the file tree opens one", () => {
    useEditorStore.getState().openTab(fileTab("a", "/v/a.md"));

    expect(lastOpened()).toBe("/v/a.md");
    expect(recentPaths()).toEqual(["/v/a.md"]);
  });

  it("follows the active tab when the user switches", () => {
    useEditorStore.getState().openTab(fileTab("a", "/v/a.md"));
    useEditorStore.getState().openTab(fileTab("b", "/v/b.md"));
    expect(lastOpened()).toBe("/v/b.md");

    useEditorStore.getState().setActiveTab("a");

    expect(lastOpened()).toBe("/v/a.md");
    expect(recentPaths()).toEqual(["/v/a.md", "/v/b.md"]);
  });

  it("writes nothing when the same tab is activated again", () => {
    useEditorStore.getState().openTab(fileTab("a", "/v/a.md"));
    const before = useSettingsStore.getState();

    useEditorStore.getState().setActiveTab("a");
    useEditorStore.getState().markDirty("a", true);

    // Same state object: no `set` ran, so no subscriber woke and no persist write.
    expect(useSettingsStore.getState()).toBe(before);
  });

  it("writes nothing when the active file is already the recorded one", () => {
    // The launch restore activating `lastOpenedFile` itself: nothing changed.
    useSettingsStore.getState().addRecentFile("/v/a.md");
    const before = useSettingsStore.getState();

    useEditorStore.getState().openTab(fileTab("a", "/v/a.md"));

    expect(useSettingsStore.getState()).toBe(before);
  });

  it("keeps the last file when a graph, plugin or untitled tab becomes active", () => {
    useEditorStore.getState().openTab(fileTab("a", "/v/a.md"));

    useEditorStore.getState().openGraphTab();
    useEditorStore.getState().openPluginTab("p", "Plugin");
    useEditorStore.getState().openTab(fileTab("u", ""));

    expect(useEditorStore.getState().activeTabId).toBe("u");
    expect(lastOpened()).toBe("/v/a.md");
    expect(recentPaths()).toEqual(["/v/a.md"]);
  });

  it("does not record a tab opened in the background", () => {
    useEditorStore.getState().openTab(fileTab("a", "/v/a.md"));

    useEditorStore
      .getState()
      .openTab(fileTab("b", "/v/b.md"), { activate: false });

    expect(lastOpened()).toBe("/v/a.md");
    // …until the user brings it forward.
    useEditorStore.getState().setActiveTab("b");
    expect(lastOpened()).toBe("/v/b.md");
  });

  it("follows the active file when it is renamed", () => {
    useEditorStore.getState().openTab(fileTab("a", "/v/a.md"));

    useEditorStore
      .getState()
      .renameTab("/v/a.md", "/v/renamed.md", "renamed.md");

    expect(lastOpened()).toBe("/v/renamed.md");
  });
});

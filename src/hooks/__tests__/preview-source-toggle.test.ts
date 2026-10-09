// §392 spec 0071 D16 · §6.6 · §7.4 — the preview ↔ source set lives in the store, and the toggle
// takes a pending viewer change BEFORE it changes that set: the code surface it puts up reads
// the buffer in render. Whether that render then reads 0 times is pinned with the real host in
// `components/editor/__tests__/viewer-edit-render-time.test.tsx`.
import type { PluginFileViewer } from "../../plugins/plugin-ui-store";
import type { ViewerEditMount } from "../../plugins/viewer-edit-mounts";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import {
  registerViewerEditMount,
  unregisterViewerEditMount,
} from "../../plugins/viewer-edit-mounts";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { logger } from "../../utils/logger";
import { useActiveTabSurface } from "../use-active-tab-surface";
import { usePreviewSourceView } from "../use-preview-source-view";
import { useSourceMode } from "../use-source-mode";

const writeFile = vi.fn(async (_path: string, _content: string) => {});
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

const PATH = "/v/a.strokes";
const TAB = "t1";
const viewer: PluginFileViewer = {
  editable: true,
  extensions: ["strokes"],
  getText: () => "",
  onMount: () => {},
  pluginId: "sketch",
  viewerId: "sketch:pad",
};
const registered: ViewerEditMount[] = [];
let toasts: string[] = [];
let stopToasts = () => {};

/** A registered editing mount with a change pending, whose getText runs `getText`. */
function viewerMount(getText: () => string): ViewerEditMount {
  const m: ViewerEditMount = {
    deliver: () => {},
    el: document.createElement("div"),
    filePath: PATH,
    getText,
    pending: true,
    pluginId: "sketch",
    tabId: TAB,
    viewerId: "sketch:pad",
  };
  registerViewerEditMount(m);
  registered.push(m);
  return m;
}

/** The buffer, the active-tab snapshot and the toggle, as App wires them; T0 in the buffer. */
function setup() {
  const hook = renderHook(() => {
    const sm = useSourceMode({ editor: null });
    const surface = useActiveTabSurface();
    const view = usePreviewSourceView({
      getSourceBuffer: sm.getSourceBuffer,
      markDirty: surface.markDirty,
      toggleSourceMode: sm.toggleSourceMode,
    });
    return { sm, surface, view };
  });
  act(() => hook.result.current.sm.setSourceBuffer(TAB, "T0"));
  return hook;
}

beforeEach(() => {
  writeFile.mockClear();
  useSettingsStore.setState({ locale: "en" } as never);
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  usePluginUIStore.setState({ fileViewers: [viewer] });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [TAB],
    previewSourceTabs: [],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    tabs: [
      {
        contextId: "c",
        filePath: PATH,
        id: TAB,
        isDirty: false,
        isPinned: false,
        title: "a.strokes",
      },
    ],
  });
  useUIStore.getState().dismissToast();
  toasts = [];
  stopToasts = useUIStore.subscribe((s, prev) => {
    if (s.toast && s.toast !== prev.toast) toasts.push(s.toast.message);
  });
});
afterEach(() => {
  stopToasts();
  for (const m of registered.splice(0)) unregisterViewerEditMount(m);
  vi.restoreAllMocks();
});

describe("the preview ↔ source set (§6.6 · P5)", () => {
  it("lives in the store, and the active-tab snapshot reads it", () => {
    const hook = setup();
    act(() => hook.result.current.view.toggleHtmlView());
    expect(useEditorStore.getState().previewSourceTabs).toEqual([TAB]);
    expect(hook.result.current.surface.isHtmlSourceView).toBe(true);
    act(() => hook.result.current.view.toggleHtmlView());
    expect(useEditorStore.getState().previewSourceTabs).toEqual([]);
    expect(hook.result.current.surface.isHtmlSourceView).toBe(false);
  });

  it("can be switched from outside React, and the snapshot follows", () => {
    const hook = setup();
    act(() => useEditorStore.getState().setPreviewSourceForTab(TAB, true));
    expect(hook.result.current.surface.isHtmlSourceView).toBe(true);
  });
});

describe("preview → source takes first (D16)", () => {
  it("calls getText once, before the store changes", () => {
    const hook = setup();
    const events: string[] = [];
    viewerMount(() => {
      events.push("getText");
      return "T1";
    });
    const stop = useEditorStore.subscribe((s, prev) => {
      if (s.previewSourceTabs !== prev.previewSourceTabs) events.push("store");
    });
    act(() => hook.result.current.view.toggleHtmlView());
    stop();
    expect(events).toEqual(["getText", "store"]);
    expect(hook.result.current.sm.getSourceBuffer(TAB)).toBe("T1");
  });

  it("after a failed take the tab stays in source view — the toggle does not flip it back — and one toast shows", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const hook = setup();
    viewerMount(() => {
      throw new Error("boom");
    });
    act(() => hook.result.current.view.toggleHtmlView());
    expect(useEditorStore.getState().previewSourceTabs).toEqual([TAB]);
    expect(toasts).toHaveLength(1);
  });
});

describe("source → preview: the flush (D17)", () => {
  it("writes a dirty tab's buffer first, then shows the preview", async () => {
    const hook = setup();
    act(() => hook.result.current.sm.setSourceBuffer(TAB, "T9"));
    useEditorStore.setState({ previewSourceTabs: [TAB] });
    useEditorStore.getState().markDirty(TAB, true);
    act(() => hook.result.current.view.toggleHtmlView());
    expect(writeFile).toHaveBeenCalledWith(PATH, "T9");
    expect(useEditorStore.getState().previewSourceTabs).toEqual([]);
    // The flush lowers dirty when its write resolves.
    await vi.waitFor(() =>
      expect(useEditorStore.getState().tabs[0].isDirty).toBe(false),
    );
  });

  it("keeps the tab dirty when a change another read took during the write is not what it wrote", async () => {
    let release = () => {};
    writeFile.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const hook = setup();
    act(() => hook.result.current.sm.setSourceBuffer(TAB, "T9"));
    useEditorStore.setState({ previewSourceTabs: [TAB] });
    useEditorStore.getState().markDirty(TAB, true);
    act(() => hook.result.current.view.toggleHtmlView());
    expect(writeFile).toHaveBeenCalledWith(PATH, "T9");
    // The preview's editing mount draws T10 while the write is out, and a read that is not the
    // flush's (a zoom tick, D10) takes it — so D15 has no mark left to hold the tab dirty.
    const m = viewerMount(() => "T10");
    expect(hook.result.current.sm.getSourceBuffer(TAB)).toBe("T10");
    expect(m.pending).toBe(false);
    release();
    // `setFileContent` runs in the same callback, just before the D17 line — once the cache
    // holds T9, that line has run.
    await vi.waitFor(() =>
      expect(useFileStore.getState().openFiles.get(PATH)).toBe("T9"),
    );
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });
});

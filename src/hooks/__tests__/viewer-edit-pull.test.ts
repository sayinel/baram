// §392 spec 0071 §6.3 · §6.4 · §7.4 · §10 (읽기 · 실패) — the source buffer's side of an editing
// mount: a read takes a pending viewer change exactly once and without a render, another
// writer's text replaces it, and a failed take falls back to the last text, switches the tab to
// source and says so once.
import type { ViewerEditMount } from "../../plugins/viewer-edit-mounts";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../i18n";
import {
  registerViewerEditMount,
  unregisterViewerEditMount,
} from "../../plugins/viewer-edit-mounts";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { logger } from "../../utils/logger";
import { useSourceMode } from "../use-source-mode";

const TAB = "t1";
const registered: ViewerEditMount[] = [];
let toasts: string[] = [];
let stopToasts = () => {};

/** A registered editing mount for `tabId` whose getText runs `getText`. */
function viewerMount(getText: () => unknown, tabId = TAB): ViewerEditMount {
  const m: ViewerEditMount = {
    deliver: vi.fn(),
    el: document.createElement("div"),
    filePath: "/v/a.strokes",
    getText: vi.fn(getText) as unknown as (el: HTMLElement) => string,
    pending: false,
    pluginId: "sketch",
    tabId,
    viewerId: "sketch:pad",
  };
  registerViewerEditMount(m);
  registered.push(m);
  return m;
}

/** `useSourceMode` with T0 in the tab's buffer, counting its renders. */
function setup() {
  let renders = 0;
  const hook = renderHook(() => {
    renders += 1;
    return useSourceMode({ editor: null });
  });
  act(() => hook.result.current.setSourceBuffer(TAB, "T0"));
  return { hook, renders: () => renders };
}

beforeEach(() => {
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [TAB],
    previewSourceTabs: [],
    sourceModeTabs: [],
    tabs: [
      {
        contextId: "c",
        filePath: "/v/a.strokes",
        id: TAB,
        isDirty: true,
        isPinned: false,
        title: "a.strokes",
      },
    ],
  });
  useSettingsStore.setState({ locale: "en" } as never);
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

describe("a read takes a pending change (§6.3 · D9)", () => {
  it("calls getText once and returns its text; the next read calls it 0 times", () => {
    const { hook } = setup();
    const m = viewerMount(() => "T1");
    m.pending = true;
    expect(hook.result.current.getSourceBuffer(TAB)).toBe("T1");
    expect(hook.result.current.getSourceBuffer(TAB)).toBe("T1");
    expect(m.getText).toHaveBeenCalledTimes(1);
  });

  it("calls getText 0 times when no change is pending", () => {
    const { hook } = setup();
    const m = viewerMount(() => "T1");
    expect(hook.result.current.getSourceBuffer(TAB)).toBe("T0");
    expect(m.getText).not.toHaveBeenCalled();
  });

  it("sends no onUpdate and causes no render", () => {
    const { hook, renders } = setup();
    const m = viewerMount(() => "T1");
    m.pending = true;
    const version = hook.result.current.bufferVersion;
    const before = renders();
    hook.result.current.getSourceBuffer(TAB);
    // The take really happened — without this the rows below hold vacuously before the change.
    expect(m.getText).toHaveBeenCalledTimes(1);
    expect(m.deliver).not.toHaveBeenCalled();
    expect(renders()).toBe(before);
    expect(hook.result.current.bufferVersion).toBe(version);
  });

  it("takes the same way for a caller outside React (sourceBufferAccess)", () => {
    setup();
    const m = viewerMount(() => "T1");
    m.pending = true;
    expect(
      useEditorStore.getState().sourceBufferAccess?.getSourceBuffer(TAB),
    ).toBe("T1");
    expect(m.getText).toHaveBeenCalledTimes(1);
  });
});

describe("another writer (§6.4)", () => {
  it("sends the new text once and drops the pending change", () => {
    const { hook } = setup();
    const m = viewerMount(() => "T1");
    m.pending = true;
    act(() => hook.result.current.setSourceBuffer(TAB, "T2"));
    expect(m.deliver).toHaveBeenCalledTimes(1);
    expect(m.deliver).toHaveBeenCalledWith("T2");
    expect(hook.result.current.getSourceBuffer(TAB)).toBe("T2");
    expect(m.getText).not.toHaveBeenCalled();
  });

  it("sends nothing for the text the buffer already holds, and the pending change stays", () => {
    const { hook } = setup();
    const m = viewerMount(() => "T1");
    m.pending = true;
    act(() => hook.result.current.setSourceBuffer(TAB, "T0"));
    expect(m.deliver).not.toHaveBeenCalled();
    expect(hook.result.current.getSourceBuffer(TAB)).toBe("T1");
  });

  it("sends the first text again when it is written back after a take made the buffer T1", () => {
    const { hook } = setup();
    const m = viewerMount(() => "T1");
    m.pending = true;
    hook.result.current.getSourceBuffer(TAB);
    act(() => hook.result.current.setSourceBuffer(TAB, "T0"));
    expect(m.deliver).toHaveBeenCalledWith("T0");
  });
});

describe("a failed take (§7.4)", () => {
  const failures = [
    [
      "throws",
      () => {
        throw new Error("boom");
      },
    ],
    ["returns a non-string", () => 42],
  ] as const;

  it.each(failures)(
    "getText %s: the last text is returned, the tab goes to source, one toast, and markDirty(false) can clear dirty",
    (_name, getText) => {
      vi.spyOn(logger, "error").mockImplementation(() => {});
      const { hook } = setup();
      const m = viewerMount(getText);
      m.pending = true;
      expect(hook.result.current.getSourceBuffer(TAB)).toBe("T0");
      expect(useEditorStore.getState().previewSourceTabs).toEqual([TAB]);
      expect(toasts).toEqual([t("viewer.edit.pullFailed", "en")]);
      expect(logger.error).toHaveBeenCalledTimes(1);
      // The mark is gone, so D15 no longer holds the tab dirty (spec §7.4 step 1).
      useEditorStore.getState().markDirty(TAB, false);
      expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
    },
  );

  it("is handled the same for a caller outside React", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    setup();
    const m = viewerMount(() => {
      throw new Error("boom");
    });
    m.pending = true;
    expect(
      useEditorStore.getState().sourceBufferAccess?.getSourceBuffer(TAB),
    ).toBe("T0");
    expect(useEditorStore.getState().previewSourceTabs).toEqual([TAB]);
    expect(toasts).toHaveLength(1);
  });

  it("does not switch or toast for a tab that is already closed (§7.2)", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const { hook } = setup();
    const m = viewerMount(() => {
      throw new Error("boom");
    }, "gone");
    m.pending = true;
    hook.result.current.getSourceBuffer("gone");
    expect(useEditorStore.getState().previewSourceTabs).toEqual([]);
    expect(toasts).toEqual([]);
  });

  it("renameTab with a getText that throws still moves the path, keeps the last text and runs the failure handling", () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    setup();
    const m = viewerMount(() => {
      throw new Error("boom");
    });
    m.pending = true;
    useEditorStore
      .getState()
      .renameTab("/v/a.strokes", "/v/b.strokes", "b.strokes");
    const state = useEditorStore.getState();
    expect(m.getText).toHaveBeenCalledTimes(1);
    expect(state.tabs[0].filePath).toBe("/v/b.strokes");
    expect(state.sourceBufferAccess?.getSourceBuffer(TAB)).toBe("T0");
    expect(state.previewSourceTabs).toEqual([TAB]);
    expect(toasts).toHaveLength(1);
  });
});

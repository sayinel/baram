// §392 spec 0071 §6.2 · D8 · D15 · D17 · §10 (markChanged · 저장 중 편집 · 저장 비교) — the auto-save a
// viewer change arms, and the auto-save's rule for lowering dirty (D17), which code tabs share.
// The editing mount is stood in for by a registry entry and `markChanged` below, which does what
// the host's does (spec §6.2: mark, markDirty(true), re-arm). The host's own `markChanged` is
// pinned in `viewer-edit-render-time.test.tsx` (Task 7) by three of the five rows in the first
// describe here — "one call alone", "N calls" and "with auto-save off".
import type { ViewerEditMount } from "../../plugins/viewer-edit-mounts";

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerViewerEditMount,
  unregisterViewerEditMount,
} from "../../plugins/viewer-edit-mounts";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useCodeAutoSave } from "../use-code-auto-save";
import { useSourceMode } from "../use-source-mode";

/** Writes the test holds open, to put a viewer change inside a save's write. */
const held: { content: string; release: () => void }[] = [];
let hold = false;
const writeFile = vi.fn((_path: string, content: string): Promise<void> =>
  hold
    ? new Promise<void>((resolve) => {
        held.push({ content, release: resolve });
      })
    : Promise.resolve(),
);
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

const PATH = "/v/a.strokes";
const TAB = "t1";
let model = "";
let mount: ViewerEditMount;

function setup() {
  const hook = renderHook(() => {
    const sm = useSourceMode({ editor: null });
    const markDirty = useEditorStore((s) => s.markDirty);
    const auto = useCodeAutoSave({
      bufferVersion: sm.bufferVersion,
      getSourceBuffer: sm.getSourceBuffer,
      isEditableTextFile: true,
      markDirty,
      sourceModeTabs: sm.sourceModeTabs,
    });
    return { auto, sm };
  });
  act(() => hook.result.current.sm.setSourceBuffer(TAB, "T0"));
  return hook;
}

/** What the host's `markChanged` does (spec §6.2). */
function markChanged(rearm: (tabId: string) => void, text: string): void {
  model = text;
  mount.pending = true;
  useEditorStore.getState().markDirty(TAB, true);
  rearm(TAB);
}

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const dirty = () => useEditorStore.getState().tabs[0].isDirty;

beforeEach(() => {
  vi.useFakeTimers();
  hold = false;
  held.length = 0;
  writeFile.mockClear();
  model = "";
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 2000 } as never);
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([[PATH, "T0"]]),
  });
  const tab = (id: string, filePath: string) => ({
    contextId: "c",
    filePath,
    id,
    isDirty: false,
    isPinned: false,
    title: id,
  });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [TAB, "t2"],
    previewSourceTabs: [],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    tabs: [tab(TAB, PATH), tab("t2", "/v/b.strokes")],
  });
  mount = {
    deliver: () => {},
    el: document.createElement("div"),
    filePath: PATH,
    getText: () => model,
    pending: false,
    pluginId: "sketch",
    tabId: TAB,
    viewerId: "sketch:pad",
  };
  registerViewerEditMount(mount);
});
afterEach(() => {
  unregisterViewerEditMount(mount);
  vi.useRealTimers();
});

describe("a viewer change re-arms auto-save (§6.2 · D8)", () => {
  it("one call alone: the tab goes dirty and one save follows the delay, with getText's text", async () => {
    const hook = setup();
    act(() => markChanged(hook.result.current.auto.rearmForViewerEdit, "T1"));
    expect(dirty()).toBe(true);
    await advance(1999);
    expect(writeFile).not.toHaveBeenCalled();
    await advance(1);
    expect(writeFile.mock.calls).toEqual([[PATH, "T1"]]);
    expect(dirty()).toBe(false);
  });

  it("N calls: one save, the delay counted from the last call", async () => {
    const hook = setup();
    const rearm = hook.result.current.auto.rearmForViewerEdit;
    act(() => markChanged(rearm, "T1"));
    await advance(1000);
    act(() => markChanged(rearm, "T2"));
    await advance(999);
    act(() => markChanged(rearm, "T3"));
    await advance(1999);
    expect(writeFile).not.toHaveBeenCalled();
    await advance(1);
    expect(writeFile.mock.calls).toEqual([[PATH, "T3"]]);
  });

  it("with auto-save off: nothing is written and the tab stays dirty", async () => {
    useSettingsStore.setState({ autoSave: false } as never);
    const hook = setup();
    act(() => markChanged(hook.result.current.auto.rearmForViewerEdit, "T1"));
    await advance(10_000);
    expect(writeFile).not.toHaveBeenCalled();
    expect(dirty()).toBe(true);
  });

  it("saves only the active tab — a tab that went to the background is left for later", async () => {
    const hook = setup();
    act(() => markChanged(hook.result.current.auto.rearmForViewerEdit, "T1"));
    act(() => useEditorStore.setState({ activeTabId: "t2" }));
    await advance(2000);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("another tab's buffer write during the delay: still exactly one save, with the viewer's text (P4)", async () => {
    // Any tab's `setSourceBuffer` bumps `bufferVersion`, so the effect runs again and clears the
    // one timer the re-arm set. The save survives because the effect then arms its own for the
    // active, dirty viewer tab — at the effect's delay, counted from that write.
    const hook = setup();
    act(() => markChanged(hook.result.current.auto.rearmForViewerEdit, "T1"));
    await advance(1000);
    act(() => hook.result.current.sm.setSourceBuffer("t2", "B1"));
    await advance(1999);
    expect(writeFile).not.toHaveBeenCalled();
    await advance(1);
    expect(writeFile.mock.calls).toEqual([[PATH, "T1"]]);
    await advance(10_000);
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(dirty()).toBe(false);
  });
});

describe("the re-armed save is judged when it fires (§6.2 · P4)", () => {
  // Neither `setState` below goes through `setSourceBuffer`, so `bufferVersion` does not move
  // and the effect does not run again: the only timer is the re-arm's. "one call alone" above is
  // the positive twin — the same re-arm with the tab left as it was writes.
  it("a tab made clean without markDirty (which D15 does not see) is not written", async () => {
    const hook = setup();
    act(() => markChanged(hook.result.current.auto.rearmForViewerEdit, "T1"));
    act(() =>
      useEditorStore.setState({
        tabs: useEditorStore
          .getState()
          .tabs.map((t) => (t.id === TAB ? { ...t, isDirty: false } : t)),
      }),
    );
    await advance(2000);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("a tab whose path is no longer a file a viewer may edit (a.strokes → a.md) is not written", async () => {
    const hook = setup();
    act(() => markChanged(hook.result.current.auto.rearmForViewerEdit, "T1"));
    act(() =>
      useEditorStore.setState({
        tabs: useEditorStore
          .getState()
          .tabs.map((t) => (t.id === TAB ? { ...t, filePath: "/v/a.md" } : t)),
      }),
    );
    await advance(2000);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("the re-arm and the hook's one timer (P4)", () => {
  it("a re-arm for a tab that is not active leaves the active tab's scheduled save alone", async () => {
    // The active tab is a code tab whose save the effect armed; the re-arm names another tab.
    unregisterViewerEditMount(mount);
    useEditorStore.setState({
      tabs: useEditorStore
        .getState()
        .tabs.map((t) => (t.id === TAB ? { ...t, filePath: "/v/a.ts" } : t)),
    });
    const hook = setup();
    act(() => {
      hook.result.current.sm.setSourceBuffer(TAB, "C1");
      useEditorStore.getState().markDirty(TAB, true);
    });
    await advance(500);
    act(() => hook.result.current.auto.rearmForViewerEdit("t2"));
    await advance(10_000);
    expect(writeFile.mock.calls).toEqual([["/v/a.ts", "C1"]]);
  });

  it("is the same function after a buffer write re-renders the hook", () => {
    const hook = setup();
    const before = hook.result.current.auto.rearmForViewerEdit;
    const version = hook.result.current.sm.bufferVersion;
    act(() => hook.result.current.sm.setSourceBuffer("t2", "B1"));
    // The write did re-render the hook — `result.current` is from the render after it.
    expect(hook.result.current.sm.bufferVersion).not.toBe(version);
    expect(hook.result.current.auto.rearmForViewerEdit).toBe(before);
  });

  it("a re-arm's timer does not outlive the hook", async () => {
    const hook = setup();
    act(() => markChanged(hook.result.current.auto.rearmForViewerEdit, "T1"));
    hook.unmount();
    await advance(10_000);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe("a change during the save's write (D15 · D17)", () => {
  it("keeps the tab dirty after the write, and the next save writes the later text", async () => {
    const hook = setup();
    const rearm = hook.result.current.auto.rearmForViewerEdit;
    hold = true;
    act(() => markChanged(rearm, "T1"));
    await advance(2000);
    expect(held.map((w) => w.content)).toEqual(["T1"]);
    act(() => markChanged(rearm, "T2"));
    await act(async () => {
      held[0].release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(dirty()).toBe(true);
    hold = false;
    await advance(2000);
    expect(writeFile.mock.calls.map(([, content]) => content)).toEqual([
      "T1",
      "T2",
    ]);
    expect(dirty()).toBe(false);
  });
});

describe("a save lowers dirty only while the buffer still holds what it wrote (D17)", () => {
  it("an editable viewer: a change another read took during the write keeps the tab dirty, and the next save writes it", async () => {
    const hook = setup();
    const rearm = hook.result.current.auto.rearmForViewerEdit;
    hold = true;
    act(() => markChanged(rearm, "T1"));
    await advance(2000);
    expect(held.map((w) => w.content)).toEqual(["T1"]);
    act(() => markChanged(rearm, "T2"));
    // Stands in for a zoom tick (D10) or `saveOutgoingTab`: a read that is not this save takes
    // T2, so the mark D15 refuses on is gone before the write resolves.
    expect(hook.result.current.sm.getSourceBuffer(TAB)).toBe("T2");
    expect(mount.pending).toBe(false);
    await act(async () => {
      held[0].release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(dirty()).toBe(true);
    hold = false;
    await advance(2000);
    expect(writeFile.mock.calls.map(([, content]) => content)).toEqual([
      "T1",
      "T2",
    ]);
    expect(dirty()).toBe(false);
  });

  it("a code tab: text typed during the auto-save's write keeps the tab dirty, and the save that typing re-armed writes it", async () => {
    // A code tab has no viewer: only the effect's save, armed by `bufferVersion`, runs here.
    unregisterViewerEditMount(mount);
    useEditorStore.setState({
      tabs: useEditorStore
        .getState()
        .tabs.map((t) => (t.id === TAB ? { ...t, filePath: "/v/a.ts" } : t)),
    });
    const hook = setup();
    hold = true;
    // What the code surface's `onChange` does for a file that is not markdown
    // (`tab-surface-renderers.tsx`): the buffer, then dirty.
    const typeText = (text: string) =>
      act(() => {
        hook.result.current.sm.setSourceBuffer(TAB, text);
        useEditorStore.getState().markDirty(TAB, true);
      });
    typeText("C1");
    await advance(2000);
    expect(held.map((w) => w.content)).toEqual(["C1"]);
    typeText("C2");
    await act(async () => {
      held[0].release();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(dirty()).toBe(true);
    hold = false;
    await advance(2000);
    expect(writeFile.mock.calls).toEqual([
      ["/v/a.ts", "C1"],
      ["/v/a.ts", "C2"],
    ]);
    expect(dirty()).toBe(false);
  });
});

// §392 spec 0071 §8 · D15 · D17 · §6.6 · §10 (저장 중 편집 · 저장 비교 · 다른 이름으로 저장) — the
// manual save paths with an editable viewer drawing while they write. Auto-save is off
// throughout, so the only writes are the ones the test presses.
import type { ViewerDouble } from "../../components/editor/__tests__/viewer-edit-fixtures";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  draw,
  fill,
  harnessProps,
  lastEdit,
  newProbe,
  PATH,
  seedStores,
  sketchTab,
  TAB,
  viewerDouble,
} from "../../components/editor/__tests__/viewer-edit-fixtures";
import { ViewerEditHarness } from "../../components/editor/__tests__/viewer-edit-harness";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { hasPendingViewerEdit } from "../../plugins/viewer-edit-mounts";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { saveDirtyTab } from "../use-close-guard";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));
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
const save = vi.fn(async (): Promise<null | string> => null);
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: () => save() }));

let events: string[];
let probe: ReturnType<typeof newProbe>;
let view: ReturnType<typeof render>;

beforeEach(() => {
  events = [];
  probe = newProbe(events);
  hold = false;
  held.length = 0;
  writeFile.mockClear();
  save.mockReset().mockImplementation(async () => null);
});

/** The sketch tab with T0, a pending T1 drawn on it, auto-save off; events cleared. */
function drawnSketch(): ViewerDouble {
  const double = viewerDouble(events);
  seedStores([sketchTab()], TAB);
  useSettingsStore.setState({ autoSave: false } as never);
  usePluginUIStore.getState().registerFileViewer(double.viewer);
  view = render(<ViewerEditHarness {...harnessProps(probe)} />);
  act(() => fill(TAB, "T0"));
  act(() => draw(double, "T1"));
  events.length = 0;
  return double;
}

const ops = () => {
  if (!probe.fileOps) throw new Error("the harness has not rendered");
  return probe.fileOps;
};
const dirty = () => useEditorStore.getState().tabs[0]?.isDirty;
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("a change during a manual save's write (D15 · D17 · §8)", () => {
  it("Cmd+S: the tab stays dirty after the write, and the next Cmd+S writes the later text", async () => {
    const double = drawnSketch();
    hold = true;
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = ops().handleSave();
    });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(held[0].content).toBe("T1");
    act(() => draw(double, "T2"));
    await act(async () => {
      held[0].release();
      await saving;
    });
    expect(dirty()).toBe(true);
    hold = false;
    await act(async () => {
      await ops().handleSave();
    });
    expect(writeFile.mock.calls.map(([, content]) => content)).toEqual([
      "T1",
      "T2",
    ]);
    expect(dirty()).toBe(false);
  });

  it("Cmd+S: a change another read took during the write keeps the tab dirty, and the next Cmd+S writes it (D17)", async () => {
    const double = drawnSketch();
    hold = true;
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = ops().handleSave();
    });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(held[0].content).toBe("T1");
    act(() => draw(double, "T2"));
    // A read that is not this save — a zoom tick, which takes before it sends (D10) — takes T2,
    // so D15 has no mark left to refuse on when the write resolves.
    act(() => {
      useSettingsStore.getState().setZoomLevel(1.25);
    });
    expect(hasPendingViewerEdit(TAB)).toBe(false);
    await act(async () => {
      held[0].release();
      await saving;
    });
    expect(dirty()).toBe(true);
    hold = false;
    await act(async () => {
      await ops().handleSave();
    });
    expect(writeFile.mock.calls.map(([, content]) => content)).toEqual([
      "T1",
      "T2",
    ]);
    expect(dirty()).toBe(false);
  });

  it("Cmd+S without a change during the write leaves the tab clean (the positive half)", async () => {
    drawnSketch();
    await act(async () => {
      await ops().handleSave();
    });
    expect(writeFile.mock.calls).toEqual([[PATH, "T1"]]);
    expect(dirty()).toBe(false);
  });

  it("Cmd+S on a code tab: text set during the write keeps the tab dirty, and the next Cmd+S writes it (D17)", async () => {
    seedStores([sketchTab(TAB, "/v/a.txt")], TAB);
    useSettingsStore.setState({ autoSave: false } as never);
    view = render(<ViewerEditHarness {...harnessProps(probe)} />);
    act(() => fill(TAB, "C1"));
    act(() => useEditorStore.getState().markDirty(TAB, true));
    hold = true;
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = ops().handleSave();
    });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(held[0].content).toBe("C1");
    act(() => fill(TAB, "C2"));
    await act(async () => {
      held[0].release();
      await saving;
    });
    expect(dirty()).toBe(true);
    hold = false;
    await act(async () => {
      await ops().handleSave();
    });
    expect(writeFile.mock.calls.map(([, content]) => content)).toEqual([
      "C1",
      "C2",
    ]);
    expect(dirty()).toBe(false);
  });

  it("quit through saveDirtyTab: a viewer change during the write makes it return false and leaves the tab dirty (§8)", async () => {
    const double = drawnSketch();
    hold = true;
    let result: Promise<boolean> = Promise.resolve(true);
    const tab = useEditorStore.getState().tabs[0];
    act(() => {
      result = saveDirtyTab(tab, TAB, ops().handleSave);
    });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    act(() => draw(double, "T2"));
    await act(async () => {
      held[0].release();
      await result;
    });
    expect(await result).toBe(false);
    expect(dirty()).toBe(true);
  });

  it("Cmd+W while drawing: the tab is saved but stays open, and dirty", async () => {
    const double = drawnSketch();
    hold = true;
    act(() => ops().handleCloseTab());
    await vi.waitFor(() => expect(held).toHaveLength(1));
    act(() => draw(double, "T2"));
    await act(async () => {
      held[0].release();
      await settle();
    });
    expect(useEditorStore.getState().tabs.map((t) => t.id)).toEqual([TAB]);
    expect(dirty()).toBe(true);
  });

  it("Cmd+W with nothing drawn during the write closes the tab (the positive half — the wait above is long enough)", async () => {
    drawnSketch();
    hold = true;
    act(() => ops().handleCloseTab());
    await vi.waitFor(() => expect(held).toHaveLength(1));
    await act(async () => {
      held[0].release();
      await settle();
    });
    expect(useEditorStore.getState().tabs).toEqual([]);
  });
});

describe("Save As (§6.6 · §7.1 · P10)", () => {
  /** Press Save As, draw `during` while the dialog is open (unless null), then answer `path`. */
  async function saveAsDrawing(
    double: ViewerDouble,
    path: string,
    during: null | string,
  ): Promise<void> {
    let answer: (picked: null | string) => void = () => {};
    save.mockImplementationOnce(
      () =>
        new Promise<null | string>((resolve) => {
          answer = resolve;
        }),
    );
    let saving: Promise<void> = Promise.resolve();
    act(() => {
      saving = ops().handleSaveAs();
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    if (during !== null) act(() => draw(double, during));
    await act(async () => {
      answer(path);
      await saving;
    });
  }

  it("keeping the extension: a take before the path changes, the new mount starts from it, and the tab stays dirty", async () => {
    const double = drawnSketch();
    await saveAsDrawing(double, "/v/b.strokes", "T2");
    // The file got what was read before the dialog; the take before the path change got T2.
    expect(writeFile.mock.calls).toEqual([["/v/b.strokes", "T1"]]);
    expect(double.pathsAtGetText).toEqual([PATH, PATH]);
    expect(lastEdit(double).text).toBe("T2");
    expect(double.contexts.at(-1)?.filePath).toBe("/v/b.strokes");
    expect(dirty()).toBe(true);
  });

  it("with nothing drawn during the dialog: one take, and the tab is clean (the positive half)", async () => {
    const double = drawnSketch();
    await saveAsDrawing(double, "/v/b.strokes", null);
    expect(double.pathsAtGetText).toEqual([PATH]);
    expect(lastEdit(double).text).toBe("T1");
    expect(dirty()).toBe(false);
  });

  it("to an extension no viewer claims: the take comes before the code surface renders, and that render takes nothing (D16)", async () => {
    const double = drawnSketch();
    await saveAsDrawing(double, "/v/a.txt", "T2");
    expect(events.lastIndexOf("getText")).toBeLessThan(
      events.indexOf("render:code"),
    );
    expect(view.container.querySelector("pre.code-probe")?.textContent).toBe(
      "T2",
    );
  });
});

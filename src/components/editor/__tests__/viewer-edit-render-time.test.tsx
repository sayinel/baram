// §392 spec 0071 D16 · §6.6 · §6.2 · D8 · §10 (렌더 밖 · markChanged) — no take happens while a
// code surface renders, and a viewer's change costs one render and arms one save. The take's
// place is read off the event order: "getText" before "render:code" means it ran in the
// handler that changed the state; a "getText" after it would be a take in render.
import type { ViewerDouble } from "./viewer-edit-fixtures";
import type { RenderResult } from "@testing-library/react";

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useEditorStore } from "../../../stores/editor/editor";
import { useSettingsStore } from "../../../stores/settings/store";
import {
  count,
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
} from "./viewer-edit-fixtures";
import { ViewerEditHarness } from "./viewer-edit-harness";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));
const writeFile = vi.fn(async (_path: string, _content: string) => {});
vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

let events: string[];
let probe: ReturnType<typeof newProbe>;
let view: RenderResult;

beforeEach(() => {
  events = [];
  probe = newProbe(events);
  writeFile.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Open the sketch tab with T0 in its buffer, and forget the mount's own events. */
function mountedSketch(): ViewerDouble {
  const double = viewerDouble(events);
  seedStores([sketchTab()], TAB);
  usePluginUIStore.getState().registerFileViewer(double.viewer);
  view = render(<ViewerEditHarness {...harnessProps(probe)} />);
  act(() => fill(TAB, "T0"));
  events.length = 0;
  return double;
}

const codeText = () =>
  view.container.querySelector("pre.code-probe")?.textContent;

describe("no take in render (D16 · §6.6)", () => {
  it("preview → source: getText once inside the toggle, 0 while the code surface renders, no render-phase update", () => {
    const error = vi.spyOn(console, "error");
    const double = mountedSketch();
    act(() => draw(double, "T1"));
    act(() => probe.toggle());
    expect(events).toEqual(["getText", "render:code", "onUnmount"]);
    expect(codeText()).toBe("T1");
    expect(
      error.mock.calls.filter(([m]) => String(m).includes("while rendering")),
    ).toEqual([]);
  });

  it("a rename that changes the extension (a.strokes → a.txt): getText once inside renameTab, 0 while the code surface renders", () => {
    const double = mountedSketch();
    act(() => draw(double, "T1"));
    act(() => useEditorStore.getState().renameTab(PATH, "/v/a.txt", "a.txt"));
    expect(events).toEqual(["getText", "render:code", "onUnmount"]);
    expect(double.pathsAtGetText).toEqual([PATH]);
    expect(codeText()).toBe("T1");
  });

  it("a rename that keeps the extension: getText once before the path changes, and the new mount starts from that text (§7.1)", () => {
    const double = mountedSketch();
    act(() => draw(double, "T1"));
    act(() =>
      useEditorStore.getState().renameTab(PATH, "/v/b.strokes", "b.strokes"),
    );
    expect(events).toEqual(["getText", "onUnmount", "onMount"]);
    expect(double.pathsAtGetText).toEqual([PATH]);
    expect(lastEdit(double).text).toBe("T1");
    expect(double.contexts.at(-1)?.filePath).toBe("/v/b.strokes");
  });
});

describe("markChanged from the host's editing mount (§6.2 · D8)", () => {
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  /**
   * `mountedSketch` with auto-save on — the one describe that asserts it, on fake timers.
   * `seedStores` turns it off (see there), and it runs inside each row, after any `beforeEach`,
   * so the switch is flipped here, after the mount.
   *
   * Both settings-store `act` calls in this describe (here and in the auto-save-off row) have
   * block bodies: `setState` returns the persist middleware's `setItem()` promise, and an arrow
   * that returns it puts `act` in async mode, which nobody awaits. Measured with the arrow form
   * here (plan 0121 Task 7): this describe's first row passed, and the two after it failed in
   * `fill` — the act queue left open had kept their renders' effects from running
   * (`use-settings-effects-theme-chrome.test.tsx` notes the same).
   */
  const mountedSaving = (): ViewerDouble => {
    const double = mountedSketch();
    act(() => {
      useSettingsStore.setState({ autoSave: true } as never);
    });
    return double;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("one call alone: the tab goes dirty, and one save follows the delay with getText's text", async () => {
    const double = mountedSaving();
    act(() => draw(double, "T1"));
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
    await advance(1999);
    expect(writeFile).not.toHaveBeenCalled();
    await advance(1);
    expect(writeFile.mock.calls).toEqual([[PATH, "T1"]]);
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
  });

  it("N calls: no render and no store notification after the first, and one save the delay after the last", async () => {
    const double = mountedSaving();
    act(() => draw(double, "T1"));
    const renders = probe.appRenders;
    const notices = vi.fn();
    const unsubscribe = useEditorStore.subscribe(notices);
    for (let i = 2; i <= 5; i += 1) {
      act(() => draw(double, `T${i}`));
      await advance(1000);
    }
    unsubscribe();
    expect(probe.appRenders).toBe(renders);
    expect(notices).not.toHaveBeenCalled();
    expect(count(events, "getText")).toBe(0);
    expect(writeFile).not.toHaveBeenCalled();
    await advance(1000);
    expect(writeFile.mock.calls).toEqual([[PATH, "T5"]]);
  });

  it("with auto-save off: nothing is written and the tab stays dirty", async () => {
    // On, then off: the re-arm reads the setting when it is called, not when it was handed down.
    const double = mountedSaving();
    act(() => {
      useSettingsStore.setState({ autoSave: false } as never);
    });
    act(() => draw(double, "T1"));
    await advance(10_000);
    expect(writeFile).not.toHaveBeenCalled();
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
  });
});

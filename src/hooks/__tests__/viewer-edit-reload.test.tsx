// §392 spec 0071 §6.4 · §8 · §10 (외부 리로드) — an outside change to the file an editing mount
// shows. A clean tab reloads and the viewer is sent the new text; a pending change keeps the
// buffer (`syncSourceBuffers` compares after a take) and the tab is dirty, so the watcher sends
// the change to the conflict dialog instead.
import { act, render, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
} from "../../components/editor/__tests__/viewer-edit-fixtures";
import { ViewerEditHarness } from "../../components/editor/__tests__/viewer-edit-harness";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { triggerAutoReload } from "../use-file-operations";
import { useFileWatcher } from "../use-file-watcher";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));
const handlers = new Map<string, (event: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(name, handler);
      return () => {};
    },
  ),
}));
const readFile = vi.fn(async (_path: string) => "T2");
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => readFile(path),
  updateFileIndex: vi.fn(async () => undefined),
  watchDir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));

let events: string[];

beforeEach(() => {
  events = [];
  handlers.clear();
  readFile.mockClear();
});

/** The sketch tab showing T0, with T0 cached as the file's last known content; events cleared. */
function shownSketch() {
  const double = viewerDouble(events);
  seedStores([sketchTab()], TAB);
  useSettingsStore.setState({ autoSave: false } as never);
  useFileStore.getState().setFileContent(PATH, "T0");
  usePluginUIStore.getState().registerFileViewer(double.viewer);
  render(<ViewerEditHarness {...harnessProps(newProbe(events))} />);
  act(() => fill(TAB, "T0"));
  events.length = 0;
  return double;
}

describe("an outside change (§6.4 · §8)", () => {
  it("on a clean tab, reloads and sends the viewer the new text once", async () => {
    const double = shownSketch();
    await act(async () => {
      await triggerAutoReload(PATH, 5000);
    });
    expect(events).toEqual(["onUpdate"]);
    expect(lastEdit(double).text).toBe("T2");
  });

  it("with a pending change, keeps the buffer, sends nothing, and says the edits were kept", async () => {
    const double = shownSketch();
    act(() => draw(double, "T1"));
    await act(async () => {
      await triggerAutoReload(PATH, 5000);
    });
    expect(count(events, "onUpdate")).toBe(0);
    expect(count(events, "getText")).toBe(1);
    expect(
      useEditorStore.getState().sourceBufferAccess?.getSourceBuffer(TAB),
    ).toBe("T1");
    expect(useUIStore.getState().toast?.message).toContain(
      "your unsaved edits were kept",
    );
  });

  it("with a pending change the tab is dirty, so the watcher opens the conflict dialog instead of reloading", async () => {
    const double = shownSketch();
    act(() => draw(double, "T1"));
    renderHook(() => useFileWatcher());
    await vi.waitFor(() => expect(handlers.has("file:changed")).toBe(true));
    act(() =>
      handlers.get("file:changed")?.({
        payload: { mtime: 5000, origin: "external", path: PATH },
      }),
    );
    expect(useUIStore.getState().conflictModal?.filePath).toBe(PATH);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("on a clean tab the same event reloads (the positive half)", async () => {
    shownSketch();
    renderHook(() => useFileWatcher());
    await vi.waitFor(() => expect(handlers.has("file:changed")).toBe(true));
    await act(async () => {
      handlers.get("file:changed")?.({
        payload: { mtime: 5000, origin: "external", path: PATH },
      });
      await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
    });
    expect(useUIStore.getState().conflictModal).toBeNull();
  });
});

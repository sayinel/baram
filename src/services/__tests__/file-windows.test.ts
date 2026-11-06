// §89 What the main window knows about the file windows, and how it has them save.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: { payload: unknown }) => void;

const bus = vi.hoisted(() => {
  const handlers = new Map<string, Set<Handler>>();
  return {
    deliver(name: string, payload: unknown) {
      for (const handler of handlers.get(name) ?? []) handler({ payload });
    },
    emit: vi.fn(async () => undefined),
    emitTo: vi.fn(async () => undefined),
    handlers,
    listen: vi.fn(async (name: string, handler: Handler) => {
      const set = handlers.get(name) ?? new Set<Handler>();
      set.add(handler);
      handlers.set(name, set);
      return () => {
        set.delete(handler);
      };
    }),
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  emit: bus.emit,
  emitTo: bus.emitTo,
  listen: bus.listen,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "file-1" }),
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { useFileWindowStore } from "../../stores/system/file-windows";
import {
  followFileWindows,
  reportUnsaved,
  SAVE_REQUEST,
  SAVE_TIMEOUT_MS,
  saveFileWindows,
} from "../file-windows";

const CLOSED = "file-window://closed";
const UNSAVED = "file-window://unsaved";
const SAVED = "file-window://saved";

beforeEach(() => {
  bus.handlers.clear();
  bus.emit.mockClear();
  bus.emitTo.mockClear();
  useFileWindowStore.setState({ unsaved: new Set() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what the main window knows", () => {
  it("follows what each file window reports", async () => {
    await followFileWindows();

    bus.deliver(UNSAVED, { label: "file-1", unsaved: true });
    bus.deliver(UNSAVED, { label: "file-2", unsaved: true });
    bus.deliver(UNSAVED, { label: "file-1", unsaved: false });

    expect([...useFileWindowStore.getState().unsaved]).toEqual(["file-2"]);
  });

  // 이것을 실패시키는 것: 다시 묻지 않으면 새로고침한 main 창은 파일 창의 상태를 모른 채 종료한다.
  // 이것을 실패시키는 것: 남겨 두면 오류 화면으로 닫힌 창을 계속 세어, 종료마다 묻고 저장 요청은 시한까지 기다린다.
  it("stops counting a window once it is gone, whatever it last said", async () => {
    await followFileWindows();
    bus.deliver(UNSAVED, { label: "file-1", unsaved: true });
    bus.deliver(UNSAVED, { label: "file-2", unsaved: true });

    bus.deliver(CLOSED, "file-1");

    expect(useFileWindowStore.getState().unsaved).toEqual(new Set(["file-2"]));
  });

  // Rust sends this one, and nothing else would notice the two names drifting apart.
  it("listens for the name the backend sends", () => {
    const lib = readFileSync(resolve("src-tauri/src/lib.rs"), "utf8");

    expect(lib).toContain(`"${CLOSED}"`);
  });

  it("stops listening to both when told to", async () => {
    const stop = await followFileWindows();

    stop();
    bus.deliver(UNSAVED, { label: "file-1", unsaved: true });

    expect(useFileWindowStore.getState().unsaved).toEqual(new Set());
    expect(bus.handlers.get(CLOSED)?.size).toBe(0);
  });

  it("asks them to report again, since a reloaded window has lost what it knew", async () => {
    await followFileWindows();

    expect(bus.emit).toHaveBeenCalledWith("file-window://report");
  });

  it("a file window reports to the main window under its own label", async () => {
    await reportUnsaved(true);

    expect(bus.emitTo).toHaveBeenCalledWith("main", UNSAVED, {
      label: "file-1",
      unsaved: true,
    });
  });
});

describe("saveFileWindows", () => {
  function unsaved(...labels: string[]) {
    useFileWindowStore.setState({ unsaved: new Set(labels) });
  }

  async function whenAsked(label: string) {
    await vi.waitFor(() =>
      expect(bus.emitTo).toHaveBeenCalledWith(label, SAVE_REQUEST),
    );
  }

  it("has nothing to do when no window holds unsaved work", async () => {
    await expect(saveFileWindows()).resolves.toBe(true);
    expect(bus.emitTo).not.toHaveBeenCalled();
  });

  it("is done when each window has answered that it saved", async () => {
    unsaved("file-1", "file-2");

    const saving = saveFileWindows();
    await whenAsked("file-1");
    await whenAsked("file-2");
    bus.deliver(SAVED, { label: "file-1", ok: true });
    bus.deliver(SAVED, { label: "file-2", ok: true });

    await expect(saving).resolves.toBe(true);
  });

  // 이것을 실패시키는 것: 라벨을 비교하지 않으면 다른 창의 답으로 이 창이 저장됐다고 본다.
  it("does not take another window's answer for this one", async () => {
    vi.useFakeTimers();
    unsaved("file-1", "file-2");

    const saving = saveFileWindows();
    await whenAsked("file-2");
    bus.deliver(SAVED, { label: "file-1", ok: true });
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);

    await expect(saving).resolves.toBe(false);
  });

  it("reports a window that could not save, so the exit stops", async () => {
    unsaved("file-1");

    const saving = saveFileWindows();
    await whenAsked("file-1");
    bus.deliver(SAVED, { label: "file-1", ok: false });

    await expect(saving).resolves.toBe(false);
  });

  // 이것을 실패시키는 것: 시한이 없으면 멈춘 창 하나가 앱을 영영 못 끄게 한다.
  it("gives up on a window that never answers", async () => {
    vi.useFakeTimers();
    unsaved("file-1");

    const saving = saveFileWindows();
    await whenAsked("file-1");
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);

    await expect(saving).resolves.toBe(false);
  });

  it("stops listening once it has its answer", async () => {
    unsaved("file-1");

    const saving = saveFileWindows();
    await whenAsked("file-1");
    bus.deliver(SAVED, { label: "file-1", ok: true });
    await saving;

    expect(bus.handlers.get(SAVED)?.size).toBe(0);
  });
});

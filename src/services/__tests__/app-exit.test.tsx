// §44 창을 떠나는 모든 길은 채팅 기록을 저장한 뒤 떠나고, 저장이 멈춰도 떠날 수 있다 (#800).
//
// 저장(flushChatPersist)을 손으로 끝내는 promise 로 바꾼다. 끝내지 않으면 멈춘 IPC 와 같다.
import type { RetainedEntry } from "../../hooks/use-retained-tabs";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pendingSaves: (() => void)[] = [];
const flushChatPersist = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      pendingSaves.push(resolve);
    }),
);
const relaunch = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../stores/ai/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../stores/ai/chat")>()),
  flushChatPersist: () => flushChatPersist(),
}));
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  confirmQuit: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));

import { TabSurface } from "../../components/editor/TabSurface";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { confirmQuit } from "../../ipc/invoke";
import {
  EXIT_SAVE_TIMEOUT_MS,
  quitApp,
  relaunchApp,
  reloadWindow,
} from "../app-exit";

const originalLocation = window.location;
const reload = vi.fn();

function finishSaves() {
  for (const resolve of pendingSaves.splice(0)) resolve();
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(confirmQuit).mockClear();
  flushChatPersist.mockClear();
  relaunch.mockClear();
  reload.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(async () => {
  // 남은 저장을 끝내 다음 시험이 "멈춘 저장" 을 물려받지 않게 한다.
  finishSaves();
  await settle();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("§44 every exit saves first (#800)", () => {
  // 이것을 실패시키는 것: relaunchApp 의 `await saveBeforeExit()` 를 지우면 저장 전에 다시 시작한다.
  it("relaunching after an update waits for the save", async () => {
    const done = relaunchApp();
    await settle();
    expect(relaunch).not.toHaveBeenCalled();
    finishSaves();
    await done;
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: ErrorBoundary 의 Reload 를 `window.location.reload()` 로 되돌리면 저장하지 않는다.
  it("the error screen's Reload saves first", async () => {
    function Boom(): never {
      throw new Error("boom");
    }
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText("Reload"));
    await settle();
    expect(flushChatPersist).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    finishSaves();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: TabSurface 의 onReload 를 `window.location.reload()` 로 되돌리면 같다.
  it("a broken tab's Reload saves first", async () => {
    const entry: RetainedEntry = { kind: "plugin", tabId: "p1" };
    const stub = () => null;
    const { container } = render(
      <TabSurface
        active
        entry={entry}
        renderers={{
          code: stub,
          html: stub,
          pdf: stub,
          plugin: () => {
            throw new Error("chunk gone");
          },
        }}
      />,
    );
    fireEvent.click(
      container.querySelector('[data-surface-error-action="reload"]')!,
    );
    await settle();
    expect(flushChatPersist).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    finishSaves();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("§44 a stuck save cannot keep the app from quitting (#800)", () => {
  // 이것을 실패시키는 것: saveBeforeExit 의 `Promise.race([save, timeout])` 를 `save` 만 기다리게 하면
  // 저장이 끝나지 않는 한 영영 종료하지 않는다.
  it("quits after the bound when the save never settles", async () => {
    void quitApp();
    await settle();
    expect(confirmQuit).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXIT_SAVE_TIMEOUT_MS);
    });
    expect(confirmQuit).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: `if (abandoned)` 조기 반환을 지우면 둘째 시도가 새 저장을 시작해 다시 기다린다.
  it("does not wait again on a second attempt while that save is still stuck", async () => {
    void quitApp();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXIT_SAVE_TIMEOUT_MS);
    });
    vi.mocked(confirmQuit).mockClear();

    void quitApp();
    await settle();
    expect(confirmQuit).toHaveBeenCalledTimes(1);
    expect(flushChatPersist).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: `if (waiting) return waiting` 을 지우면 겹친 두 시도가 저장을 두 번 시작한다.
  it("two exits started together share one save", async () => {
    void quitApp();
    void reloadWindow();
    await settle();
    expect(flushChatPersist).toHaveBeenCalledTimes(1);
    finishSaves();
    await settle();
    expect(confirmQuit).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: 저장이 끝난 뒤 `abandoned` 를 비우지 않으면 다음 종료가 저장하지 않고 떠난다.
  it("waits again once the stuck save has finally settled", async () => {
    void quitApp();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXIT_SAVE_TIMEOUT_MS);
    });
    finishSaves();
    await settle();
    vi.mocked(confirmQuit).mockClear();

    void quitApp();
    await settle();
    expect(flushChatPersist).toHaveBeenCalledTimes(2);
    expect(confirmQuit).not.toHaveBeenCalled();
  });
});

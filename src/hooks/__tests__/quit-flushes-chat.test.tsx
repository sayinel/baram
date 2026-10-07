import { listen } from "@tauri-apps/api/event";

// §44 앱을 끝내거나 창을 다시 불러오기 전에 채팅 기록을 저장한다 (#800).
//
// 채팅 기록은 구간마다 한 번만 저장되므로, 마지막 순간의 대화는 아직 디스크에 없을 수 있다. 저장을
// 손으로 끝내는 promise 로 바꿔, 저장이 끝나기 전에는 종료 · 새로고침이 일어나지 않는지 본다.
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let finishFlush: () => void = () => undefined;
const flushChatPersist = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      finishFlush = resolve;
    }),
);

vi.mock("../../stores/ai/chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../stores/ai/chat")>()),
  flushChatPersist: () => flushChatPersist(),
}));
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  confirmQuit: vi.fn(async () => undefined),
}));

import { UnsavedChangesModal } from "../../components/editor/UnsavedChangesModal";
import { confirmQuit } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useUIStore } from "../../stores/ui/ui";
import { requestReload, useCloseGuard } from "../use-close-guard";

const originalLocation = window.location;
const reload = vi.fn();

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.mocked(confirmQuit).mockClear();
  flushChatPersist.mockClear();
  reload.mockClear();
  useEditorStore.setState({
    activeTabId: null,
    sourceEditedTabs: [],
    tabs: [],
  });
  useUIStore.setState({ unsavedModal: null });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

function closeRequested(): () => void {
  const call = vi
    .mocked(listen)
    .mock.calls.find((c) => c[0] === "app://close-requested");
  return call![1] as unknown as () => void;
}

// 이것을 실패시키는 것: use-close-guard.ts 의 quitApp · reloadWindow 에서 `await flushChatPersist()` 를
// 지우면 저장이 끝나기 전에 종료 · 새로고침이 일어난다.
describe("§44 quitting and reloading wait for the chat history save (#800)", () => {
  it("quits only after the chat history is saved", async () => {
    renderHook(() => useCloseGuard());
    closeRequested()();
    await settle();

    expect(flushChatPersist).toHaveBeenCalledTimes(1);
    expect(confirmQuit).not.toHaveBeenCalled();
    finishFlush();
    await settle();
    expect(confirmQuit).toHaveBeenCalledTimes(1);
  });

  it("reloads only after the chat history is saved", async () => {
    const done = requestReload();
    await settle();
    expect(reload).not.toHaveBeenCalled();
    finishFlush();
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // 이것을 실패시키는 것: UnsavedChangesModal 의 quit 갈래를 `confirmQuit()` 로 되돌리면 저장 없이 끝난다.
  it.each([
    ["quit", () => confirmQuit],
    ["reload", () => reload],
  ] as const)(
    "the unsaved-changes dialog's %s waits for it too",
    async (intent, target) => {
      useUIStore.setState({ unsavedModal: { intent } });
      render(<UnsavedChangesModal handleSave={vi.fn(async () => undefined)} />);
      await act(async () => {
        fireEvent.click(screen.getByText("Don't Save"));
      });
      await settle();

      expect(flushChatPersist).toHaveBeenCalledTimes(1);
      expect(target()).not.toHaveBeenCalled();
      finishFlush();
      await settle();
      expect(target()).toHaveBeenCalledTimes(1);
    },
  );
});

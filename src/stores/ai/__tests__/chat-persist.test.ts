// §44 채팅 기록은 답이 흐르는 동안 구간마다 한 번만 저장하고, 끝나야 할 때는 바로 저장한다 (#800).
//
// 저장의 끝은 `setConfig`(Rust 가 config.json 전체를 다시 쓰는 IPC)다. 채팅 key 로 간 호출을 센다.
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setConfig = vi.fn(async (_key: string, _value: string) => undefined);

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  getConfig: async () => null,
  removeConfig: async () => undefined,
  setConfig: (key: string, value: string) => setConfig(key, value),
}));

import { CHAT_SAVE_INTERVAL_MS, flushChatPersist, useChatStore } from "../chat";

const KEY = "baram:chat-sessions";

function chatWrites(): string[] {
  return setConfig.mock.calls.filter(([k]) => k === KEY).map(([, v]) => v);
}

function lastSavedContent(): string | undefined {
  const raw = chatWrites().at(-1);
  if (!raw) return undefined;
  const { state } = JSON.parse(raw) as {
    state: { sessions: { messages: { content: string }[] }[] };
  };
  return state.sessions[0]?.messages.at(-1)?.content;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

let session = "";

beforeEach(async () => {
  vi.useFakeTimers();
  useChatStore.setState({ activeSessionId: null, sessions: [] });
  await flushChatPersist();
  session = useChatStore.getState().createSession();
  useChatStore
    .getState()
    .addMessage(session, { content: "", role: "assistant" });
  await settle();
  await flushChatPersist();
  setConfig.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("§44 chat history saves (#800)", () => {
  // 이것을 실패시키는 것: chat.ts 의 storage 를 `createJSONStorage(() => tauriStorage)` 로 되돌리면 갱신마다
  // 저장해 100번이 된다.
  it("saves once for 100 streamed updates inside one interval, with the newest text", async () => {
    for (let i = 1; i <= 100; i++) {
      useChatStore.getState().updateLastMessage(session, "x".repeat(i));
    }
    expect(chatWrites()).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_SAVE_INTERVAL_MS);
    });

    expect(chatWrites()).toHaveLength(1);
    expect(lastSavedContent()).toBe("x".repeat(100));
  });

  // 이것을 실패시키는 것: addMessage 끝의 `flushChatPersist()` 를 지우면 구간이 지나기 전에는 저장하지 않는다.
  it("saves a new message at once", async () => {
    useChatStore
      .getState()
      .addMessage(session, { content: "hi", role: "user" });
    await settle();

    expect(chatWrites()).toHaveLength(1);
    expect(lastSavedContent()).toBe("hi");
  });

  // 이것을 실패시키는 것: deleteSession 끝의 `flushChatPersist()` 를 지우면 같다.
  it("saves a deleted session at once", async () => {
    useChatStore.getState().deleteSession(session);
    await settle();

    expect(chatWrites()).toHaveLength(1);
    expect(JSON.parse(chatWrites()[0]).state.sessions).toEqual([]);
  });

  // 이것을 실패시키는 것: chat.ts 의 `pagehide` listener 를 지우면 페이지가 떠날 때 저장하지 않는다.
  it("saves what is pending when the page goes away", async () => {
    useChatStore.getState().updateLastMessage(session, "half a reply");
    window.dispatchEvent(new Event("pagehide"));
    await settle();

    expect(chatWrites()).toHaveLength(1);
    expect(lastSavedContent()).toBe("half a reply");
  });

  // 이것을 실패시키는 것: updateLastMessage 의 `if (!last || last.content === content) return` 관문을 지우면
  // 바뀔 것이 없는 갱신도 store 를 깨우고 저장을 예약한다.
  it("writes nothing for an unchanged update or an update to a deleted session", async () => {
    useChatStore.getState().updateLastMessage(session, "same");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_SAVE_INTERVAL_MS);
    });
    setConfig.mockClear();
    let storeWrites = 0;
    const unsubscribe = useChatStore.subscribe(() => storeWrites++);

    useChatStore.getState().updateLastMessage(session, "same");
    useChatStore.getState().updateLastMessage("gone", "anything");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_SAVE_INTERVAL_MS);
    });
    await settle();

    expect(storeWrites).toBe(0);
    expect(chatWrites()).toHaveLength(0);
    // 긍정 짝 — 바뀌는 갱신은 store 를 깨우고 저장한다.
    useChatStore.getState().updateLastMessage(session, "different");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_SAVE_INTERVAL_MS);
    });
    await settle();
    expect(storeWrites).toBe(1);
    expect(chatWrites()).toHaveLength(1);
    unsubscribe();
  });
});

// §44 답이 끝나면 — 완료 · 오류 · 취소 모두 — 채팅 기록을 바로 저장한다 (#800).
//
// 답이 흐르는 동안의 저장은 구간마다 한 번이라, 마지막 조각들은 아직 디스크에 없을 수 있다. 실제 패널을
// 그리고 LLM stream hook 만 손으로 움직이는 store 로 바꿔, 끝나는 순간의 저장을 센다.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setConfig = vi.fn(async (_key: string, _value: string) => undefined);

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  getConfig: async () => null,
  removeConfig: async () => undefined,
  setConfig: (key: string, value: string) => setConfig(key, value),
}));

vi.mock("../../../hooks/use-llm-stream", async () => {
  const { create } = await import("zustand");
  const stream = create(() => ({
    error: null as null | string,
    isStreaming: false,
    text: "",
  }));
  return {
    __stream: stream,
    useLLMStream: () => ({
      ...stream(),
      cancel: () => stream.setState({ isStreaming: false }),
      send: () => stream.setState({ isStreaming: true, text: "" }),
      totalTokens: 0,
    }),
  };
});

import type { StoreApi } from "zustand";

import * as llm from "../../../hooks/use-llm-stream";
import { useAIStore } from "../../../stores/ai/ai";
import { useChatStore } from "../../../stores/ai/chat";
import { useUIStore } from "../../../stores/ui/ui";
import { AIChatPanel } from "../AIChatPanel";

type StreamState = { error: null | string; isStreaming: boolean; text: string };
const stream = (llm as unknown as { __stream: StoreApi<StreamState> }).__stream;

const KEY = "baram:chat-sessions";

function savedReply(): string | undefined {
  const raw = setConfig.mock.calls.filter(([k]) => k === KEY).at(-1)?.[1];
  if (!raw) return undefined;
  const { state } = JSON.parse(raw) as {
    state: { sessions: { messages: { content: string }[] }[] };
  };
  return state.sessions[0]?.messages.at(-1)?.content;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

/** 질문을 보내고, 답이 몇 조각 흐르게 한 뒤, 저장 기록을 비운다. */
async function streamPartOfAReply() {
  render(<AIChatPanel />);
  fireEvent.change(screen.getByPlaceholderText(/Ask AI/), {
    target: { value: "question" },
  });
  await act(async () => {
    fireEvent.click(screen.getByText("Send"));
  });
  await settle();
  for (const text of ["The", "The answer", "The answer is"]) {
    act(() => stream.setState({ text }));
  }
  setConfig.mockClear();
}

beforeEach(() => {
  vi.useFakeTimers();
  setConfig.mockClear();
  stream.setState({ error: null, isStreaming: false, text: "" });
  useAIStore.setState({ aiEnabled: true });
  useUIStore.setState({ rightPanelMode: "chat", rightPanelOpen: true });
  useChatStore.setState({ activeSessionId: null, sessions: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

// 이것을 실패시키는 것: AIChatPanel.tsx 의 완료 effect 에서 `flushChatPersist()` 를 지우면 끝나는 순간에는
// 저장하지 않아 세 시험이 모두 깨진다(구간 timer 가 아직 울리지 않았다).
describe("§44 the chat history is saved when a reply ends (#800)", () => {
  it("saves the whole reply when it completes", async () => {
    await streamPartOfAReply();
    act(() =>
      stream.setState({ isStreaming: false, text: "The answer is 42" }),
    );
    await settle();

    expect(savedReply()).toBe("The answer is 42");
  });

  it("saves what arrived when the reply fails", async () => {
    await streamPartOfAReply();
    act(() => stream.setState({ error: "network", isStreaming: false }));
    await settle();

    expect(savedReply()).toBe("The answer is");
  });

  it("saves what arrived when the user stops it", async () => {
    await streamPartOfAReply();
    await act(async () => {
      fireEvent.click(screen.getByText("Stop"));
    });
    await settle();

    expect(savedReply()).toBe("The answer is");
  });

  // 긍정 짝 — 흐르는 동안은 구간이 지나야 저장한다.
  it("does not save on every token while the reply streams", async () => {
    await streamPartOfAReply();
    act(() => stream.setState({ text: "The answer is still" }));
    await settle();
    expect(savedReply()).toBeUndefined();
  });
});

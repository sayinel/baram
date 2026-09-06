// issue 265 — useLLMStream must not leak listeners when registration fails
// half-way, must keep totalTokens from the done event, and must not let a late
// failure of an earlier send touch the request that replaced it.
import { listen } from "@tauri-apps/api/event";
import type { Event } from "@tauri-apps/api/event";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { llmComplete } from "../../ipc/invoke";
import { useAIStore } from "../../stores/ai/ai";
import { useLLMStream } from "../use-llm-stream";

vi.mock("../../ipc/invoke", () => ({
  getConfig: vi.fn().mockResolvedValue(null),
  keyringDeleteProviderKey: vi.fn().mockResolvedValue(undefined),
  keyringProviderConfigured: vi.fn().mockResolvedValue(false),
  keyringSetProviderKey: vi.fn().mockResolvedValue(undefined),
  llmCancel: vi.fn().mockResolvedValue(undefined),
  llmComplete: vi.fn().mockResolvedValue(undefined),
  setConfig: vi.fn().mockResolvedValue(undefined),
}));

const mockListen = vi.mocked(listen);
const mockComplete = vi.mocked(llmComplete);

type Handler = (event: Event<unknown>) => void;

function arrangeListen(rejectAt?: number) {
  const unlistens: ReturnType<typeof vi.fn>[] = [];
  const handlers: Record<string, Handler[]> = {};
  let call = 0;
  mockListen.mockImplementation(async (event: string, handler: Handler) => {
    call += 1;
    if (call === rejectAt) throw new Error(`listen ${call} failed`);
    (handlers[event] ??= []).push(handler);
    const un = vi.fn();
    unlistens.push(un);
    return un;
  });
  return { handlers, unlistens };
}

/** A Tauri event envelope around `payload`, as listen() handlers receive it. */
function ev(payload: unknown): Event<unknown> {
  return { event: "llm", id: 0, payload };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  mockListen.mockReset();
  mockComplete.mockReset();
  mockComplete.mockResolvedValue(undefined);
  useAIStore.setState({
    configured: { openai: true },
    model: "gpt-4o-mini",
    privacyMode: false,
    provider: "openai",
  });
});

describe("useLLMStream listener lifecycle (issue 265)", () => {
  it("unlistens the first listener and reports when the second listen() rejects", async () => {
    const { unlistens } = arrangeListen(2);
    const { result } = renderHook(() => useLLMStream());
    await act(async () => {
      result.current.send("p");
    });
    await flush();
    expect(unlistens).toHaveLength(1);
    expect(unlistens[0]).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/listener registration failed/);
    expect(result.current.isStreaming).toBe(false);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("keeps totalTokens from the done event and stops streaming", async () => {
    const { handlers } = arrangeListen();
    // The backend command resolves only after the stream is done.
    let finish!: () => void;
    mockComplete.mockImplementation(
      () => new Promise<void>((r) => (finish = r)),
    );
    const { result } = renderHook(() => useLLMStream());
    await act(async () => {
      result.current.send("p");
    });
    await flush();
    const requestId = mockComplete.mock.calls[0]![2] as string;
    act(() => {
      handlers["llm:token"]![0]!(ev({ requestId, token: "한" }));
      handlers["llm:done"]![0]!(ev({ requestId, totalTokens: 42 }));
    });
    act(() => finish());
    await flush();
    expect(result.current.text).toBe("한");
    expect(result.current.totalTokens).toBe(42);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("a late failure of an earlier send does not touch the request that replaced it", async () => {
    const { unlistens } = arrangeListen();
    const rejects: ((e: Error) => void)[] = [];
    mockComplete.mockImplementation(
      () => new Promise<void>((_r, rej) => rejects.push(rej)),
    );
    const { result } = renderHook(() => useLLMStream());
    await act(async () => {
      result.current.send("first");
    });
    await flush();
    await act(async () => {
      result.current.send("second");
    });
    await flush();
    // The first request's listeners were torn down when the second started.
    expect(unlistens).toHaveLength(6);
    for (const un of unlistens.slice(0, 3)) expect(un).toHaveBeenCalledTimes(1);
    for (const un of unlistens.slice(3)) expect(un).not.toHaveBeenCalled();

    act(() => rejects[0]!(new Error("first died late")));
    await flush();
    expect(result.current.error).toBeNull();
    expect(result.current.isStreaming).toBe(true);
    for (const un of unlistens.slice(3)) expect(un).not.toHaveBeenCalled();
  });

  it("a new send() aborts a registration still in flight and releases its first listener", async () => {
    const unlistens: ReturnType<typeof vi.fn>[] = [];
    let call = 0;
    mockListen.mockImplementation(async () => {
      call += 1;
      if (call === 2) await new Promise(() => {}); // first send stalls here
      const un = vi.fn();
      unlistens.push(un);
      return un;
    });
    const { result } = renderHook(() => useLLMStream());
    await act(async () => {
      result.current.send("first");
    });
    await flush();
    expect(unlistens).toHaveLength(1);
    await act(async () => {
      result.current.send("second");
    });
    await flush();
    expect(unlistens).toHaveLength(4);
    expect(unlistens[0]).toHaveBeenCalledTimes(1);
    for (const un of unlistens.slice(1)) expect(un).not.toHaveBeenCalled();
    expect(mockComplete).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});

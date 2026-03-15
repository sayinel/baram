import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAIStore } from "../../stores/ai/ai";
import { useLLMStream } from "../use-llm-stream";

// Mock Tauri IPC — provide all exports consumed by tauri-storage + ai-store + use-llm-stream
vi.mock("../../ipc/invoke", () => ({
  llmComplete: vi.fn().mockResolvedValue(undefined),
  llmCancel: vi.fn().mockResolvedValue(undefined),
  // tauri-storage calls these via ipc/invoke re-exports
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
  // ai-store keyring calls
  keyringGet: vi.fn().mockResolvedValue(null),
  keyringStore: vi.fn().mockResolvedValue(undefined),
}));

describe("useLLMStream — task-aware config", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useAIStore.setState({
      provider: "claude",
      model: "claude-sonnet-4-5",
      apiKey: "sk-global",
      autoModelEnabled: true,
      providerForGhostText: "openai",
      modelForGhostText: "gpt-4o-mini",
      providerForInlineEdit: "claude",
      modelForInlineEdit: "claude-sonnet-4-5",
      providerForChat: "",
      modelForChat: "",
      providerForAgent: "",
      modelForAgent: "",
      apiKeys: { claude: "sk-global", openai: "sk-openai" },
      privacyMode: false,
      ollamaUrl: "http://localhost:11434",
    });
  });

  it("passes task-specific provider/model to IPC when task is provided", async () => {
    const { llmComplete } = await import("../../ipc/invoke");
    const { result } = renderHook(() => useLLMStream());

    await act(async () => {
      result.current.send("test prompt", "system prompt", {
        task: "ghost-text",
      });
    });

    expect(llmComplete).toHaveBeenCalledWith(
      "sk-openai", // apiKey for openai
      "test prompt",
      "gpt-4o-mini", // model for ghost-text
      expect.any(String), // requestId
      "system prompt",
      undefined, // maxTokens
      "openai", // provider for ghost-text
      undefined, // baseUrl (openai is not ollama)
      false, // privacyMode
    );
  });

  it("uses global config when no task is specified", async () => {
    const { llmComplete } = await import("../../ipc/invoke");
    const { result } = renderHook(() => useLLMStream());

    await act(async () => {
      result.current.send("test prompt", "system prompt");
    });

    // No task → defaults to "chat" task, but providerForChat is "" so falls back to global
    expect(llmComplete).toHaveBeenCalledWith(
      "sk-global", // apiKey for claude (global)
      "test prompt",
      "claude-sonnet-4-5", // global model
      expect.any(String),
      "system prompt",
      undefined,
      "claude", // global provider
      undefined, // baseUrl
      false,
    );
  });

  it("blocks cloud providers when privacy mode is on", async () => {
    useAIStore.setState({ privacyMode: true });
    const { result } = renderHook(() => useLLMStream());

    await act(async () => {
      result.current.send("test prompt");
    });

    expect(result.current.error).toContain("Privacy mode");
  });
});

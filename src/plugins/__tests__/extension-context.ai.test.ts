import type { PluginManifest } from "../types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const llmComplete = vi.fn(async () => {});
const llmListModels = vi.fn(async () => [{ id: "m1", name: "Model One" }]);
let lastCbs: null | {
  onDone?: () => void;
  onError?: (e: string) => void;
  onToken: (t: string) => void;
} = null;
const cleanup = vi.fn();
const createLLMStream = vi.fn(async (_id: string, cbs: typeof lastCbs) => {
  lastCbs = cbs;
  return cleanup;
});

vi.mock("../../ipc/llm", () => ({
  llmComplete: (...a: unknown[]) => llmComplete(...(a as [])),
  llmListModels: (...a: unknown[]) => llmListModels(...(a as [])),
}));
vi.mock("../../utils/llm-stream", () => ({
  createLLMStream: (...a: unknown[]) =>
    createLLMStream(...(a as [string, typeof lastCbs])),
}));

import { useAIStore } from "../../stores/ai/ai";
import { createExtensionContext } from "../extension-context";

function mf(caps: string[]): PluginManifest {
  return {
    id: "ai-plugin",
    name: "AI",
    description: "",
    version: "1.0.0",
    author: "",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: ">=0.2.0" },
    capabilities: caps as PluginManifest["capabilities"],
    trust: "sandboxed",
  };
}

describe("ExtensionContext ai API", () => {
  beforeEach(() => {
    llmComplete.mockClear();
    llmListModels.mockClear();
    createLLMStream.mockClear();
    cleanup.mockClear();
    lastCbs = null;
  });

  afterEach(() => {
    // Guard against leaking privacy-mode overrides into the other ai tests,
    // which all assume the default privacyMode=false / provider="claude".
    useAIStore.setState({ privacyMode: false, provider: "claude" });
  });

  it("denies ai without the 'ai' capability", () => {
    const ctx = createExtensionContext(mf(["commands"]), "/p");
    expect(() => ctx.ai.complete("hi")).toThrow(/ai/i);
  });

  it("complete buffers tokens and resolves on done, cleaning up in finally", async () => {
    const ctx = createExtensionContext(mf(["ai"]), "/p");
    const p = ctx.ai.complete("hi");
    // llmComplete kicked off streaming; fire fake tokens + done.
    expect(lastCbs).not.toBeNull();
    lastCbs!.onToken("Hel");
    lastCbs!.onToken("lo");
    lastCbs!.onDone!();
    await expect(p).resolves.toBe("Hello");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("complete rejects on error", async () => {
    const ctx = createExtensionContext(mf(["ai"]), "/p");
    const p = ctx.ai.complete("hi");
    lastCbs!.onError!("boom");
    await expect(p).rejects.toThrow(/boom/);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("stream forwards tokens to onToken and resolves on done", async () => {
    const ctx = createExtensionContext(mf(["ai"]), "/p");
    const seen: string[] = [];
    const p = ctx.ai.stream("hi", {}, (t) => seen.push(t));
    lastCbs!.onToken("a");
    lastCbs!.onToken("b");
    lastCbs!.onDone!();
    await p;
    expect(seen).toEqual(["a", "b"]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("listModels maps ModelInfo to AIModel", async () => {
    const ctx = createExtensionContext(mf(["ai"]), "/p");
    await expect(ctx.ai.listModels()).resolves.toEqual([
      { id: "m1", name: "Model One" },
    ]);
  });

  it("complete/stream both reject when privacy mode forbids the resolved provider, before touching the LLM", async () => {
    // Real store + real isLLMAllowed: privacyMode=true + a cloud provider
    // ("claude") makes isLLMAllowed() return false, so start() must throw
    // before any createLLMStream/llmComplete call.
    useAIStore.setState({ privacyMode: true, provider: "claude" });
    const ctx = createExtensionContext(mf(["ai"]), "/p");

    await expect(ctx.ai.complete("hi")).rejects.toThrow(/privacy/i);
    await expect(ctx.ai.stream("hi", {}, () => {})).rejects.toThrow(/privacy/i);

    expect(createLLMStream).not.toHaveBeenCalled();
    expect(llmComplete).not.toHaveBeenCalled();
  });
});

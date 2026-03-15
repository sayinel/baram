import { beforeEach, describe, expect, it } from "vitest";

import { useAIStore } from "../../stores/ai/ai";
import { getConfigForTask } from "../model-selection";

describe("getConfigForTask — full config", () => {
  beforeEach(() => {
    useAIStore.setState({
      provider: "claude",
      model: "claude-sonnet-4-5",
      apiKey: "sk-global",
      autoModelEnabled: false,
      providerForGhostText: "openai",
      modelForGhostText: "gpt-4o-mini",
      providerForInlineEdit: "claude",
      modelForInlineEdit: "claude-sonnet-4-5",
      providerForChat: "",
      modelForChat: "",
      providerForAgent: "",
      modelForAgent: "",
      apiKeys: { claude: "sk-global", openai: "sk-openai-key" },
      ollamaUrl: "http://localhost:11434",
    });
  });

  it("returns global config when autoModelEnabled is false", () => {
    const config = getConfigForTask("ghost-text");
    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-sonnet-4-5");
  });

  it("returns task-specific config when autoModelEnabled is true", () => {
    useAIStore.setState({ autoModelEnabled: true });
    const config = getConfigForTask("ghost-text");
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o-mini");
  });

  it("falls back to global when task-specific provider is empty", () => {
    useAIStore.setState({ autoModelEnabled: true });
    const config = getConfigForTask("chat");
    expect(config.provider).toBe("claude");
    expect(config.model).toBe("claude-sonnet-4-5");
  });

  it("returns apiKey for the resolved provider", () => {
    useAIStore.setState({ autoModelEnabled: true });
    const config = getConfigForTask("ghost-text");
    expect(config.apiKey).toBe("sk-openai-key");
  });

  it("returns ollamaUrl as baseUrl for ollama provider", () => {
    useAIStore.setState({
      autoModelEnabled: true,
      providerForGhostText: "ollama",
      modelForGhostText: "llama3",
    });
    const config = getConfigForTask("ghost-text");
    expect(config.provider).toBe("ollama");
    expect(config.baseUrl).toBe("http://localhost:11434");
  });

  it("returns undefined baseUrl for non-ollama providers", () => {
    const config = getConfigForTask("ghost-text");
    expect(config.baseUrl).toBeUndefined();
  });
});

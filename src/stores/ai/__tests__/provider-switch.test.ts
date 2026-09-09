import { beforeEach, describe, expect, it } from "vitest";

import { getConfigForTask } from "../../../utils/model-selection";
import { useAIStore } from "../ai";
import { AI_PROVIDERS } from "../providers";

// Changing the default provider used to write nothing but `provider`, which
// left every per-task model override naming a model from the provider the user
// just left. Because a task with an empty provider field inherits the default
// one, `getConfigForTask` then paired the new provider with the old provider's
// model id and the request failed at use time — the UI only hinted at it, by
// showing an empty selection for a value no catalogue could match.

const initial = useAIStore.getState();

describe("setProvider", () => {
  beforeEach(() => {
    useAIStore.setState(initial, true);
  });

  it("reads per-task overrides only when auto model selection is on", () => {
    // The premise the assertions below rest on. With it off, getConfigForTask
    // returns the main config and every per-task claim would hold vacuously.
    useAIStore.setState({
      autoModelEnabled: false,
      model: "main-model",
      modelForChat: "task-model",
      provider: "openrouter",
    });
    expect(getConfigForTask("chat").model).toBe("main-model");

    useAIStore.setState({ autoModelEnabled: true });
    expect(getConfigForTask("chat").model).toBe("task-model");
  });

  it("selects the new provider's default model", () => {
    useAIStore.setState({ model: "gemini-2.0-flash", provider: "gemini" });

    useAIStore.getState().setProvider("openrouter");

    expect(useAIStore.getState().model).toBe(
      AI_PROVIDERS.openrouter.defaultModel,
    );
  });

  it("clears the per-task models that follow the default provider", () => {
    // The state the running app actually had on disk after a switch to
    // OpenRouter: Gemini ids on three tasks, none of them pinned.
    useAIStore.setState({
      autoModelEnabled: true,
      model: "gemini-2.0-flash",
      modelForAgent: "gemini-3.1-pro-preview",
      modelForChat: "gemini-3.1-pro-preview",
      modelForGhostText: "gemini-3.5-flash-lite",
      modelForInlineEdit: "",
      provider: "gemini",
      providerForAgent: "",
      providerForChat: "",
      providerForGhostText: "",
      providerForInlineEdit: "",
    });

    useAIStore.getState().setProvider("openrouter");

    const s = useAIStore.getState();
    expect(s.modelForAgent).toBe("");
    expect(s.modelForChat).toBe("");
    expect(s.modelForGhostText).toBe("");

    // What the defect actually cost: the model a request would carry.
    for (const task of [
      "agent",
      "chat",
      "ghost-text",
      "inline-edit",
    ] as const) {
      const config = getConfigForTask(task);
      expect(config.provider, task).toBe("openrouter");
      expect(config.model, task).not.toContain("gemini");
    }
  });

  it("keeps a per-task model that is pinned to its own provider", () => {
    // An explicit per-task provider does not follow the default, so its model
    // is still valid after a default change. Clearing it would silently
    // discard a deliberate choice.
    useAIStore.setState({
      autoModelEnabled: true,
      modelForChat: "claude-sonnet-4-5-20250929",
      provider: "gemini",
      providerForChat: "claude",
    });

    useAIStore.getState().setProvider("openrouter");

    expect(useAIStore.getState().modelForChat).toBe(
      "claude-sonnet-4-5-20250929",
    );
    expect(getConfigForTask("chat")).toMatchObject({
      model: "claude-sonnet-4-5-20250929",
      provider: "claude",
    });
  });

  it("does not touch state when the provider is unchanged", () => {
    useAIStore.setState({
      model: "some-pinned-model",
      modelForChat: "another-model",
      provider: "openrouter",
    });
    const before = useAIStore.getState();

    useAIStore.getState().setProvider("openrouter");

    // Identity, not equality: a partial write would replace the root and wake
    // every subscriber for a no-op.
    expect(useAIStore.getState()).toBe(before);
    expect(useAIStore.getState().model).toBe("some-pinned-model");
    expect(useAIStore.getState().modelForChat).toBe("another-model");
  });
});

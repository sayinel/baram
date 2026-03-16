// Integration: AI Edit Workflow — store state transitions + ghost text + provider settings
import { beforeEach, describe, expect, it } from "vitest";

import { useAIStore } from "../../stores/ai/ai";
import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";

describe("Integration: AI Edit Workflow", () => {
  beforeEach(() => {
    useAIStore.setState({
      provider: "claude",
      model: "claude-sonnet-4-5-20250929",
      apiKey: "",
      isStreaming: false,
      ghostText: null,
    });
    useEditorStore.setState({
      activeTabId: null,
      tabs: [],
    });
  });

  it("AI store state transitions: idle → streaming → done", () => {
    const { setStreaming, setGhostText } = useAIStore.getState();

    // Idle state
    expect(useAIStore.getState().isStreaming).toBe(false);
    expect(useAIStore.getState().ghostText).toBeNull();

    // Start streaming
    setStreaming(true);
    expect(useAIStore.getState().isStreaming).toBe(true);

    // Simulate tokens arriving as ghost text
    setGhostText("Hello ");
    expect(useAIStore.getState().ghostText).toBe("Hello ");

    setGhostText("Hello World");
    expect(useAIStore.getState().ghostText).toBe("Hello World");

    // Done — stop streaming, clear ghost text
    useAIStore.getState().setStreaming(false);
    useAIStore.getState().setGhostText(null);

    expect(useAIStore.getState().isStreaming).toBe(false);
    expect(useAIStore.getState().ghostText).toBeNull();
  });

  it("ghost text accumulation simulates token streaming", () => {
    const tokens = ["The ", "quick ", "brown ", "fox"];
    let accumulated = "";

    useAIStore.getState().setStreaming(true);

    for (const token of tokens) {
      accumulated += token;
      useAIStore.getState().setGhostText(accumulated);
    }

    expect(useAIStore.getState().ghostText).toBe("The quick brown fox");
    expect(useAIStore.getState().isStreaming).toBe(true);

    // Complete
    useAIStore.getState().setStreaming(false);
    expect(useAIStore.getState().isStreaming).toBe(false);
  });

  it("accept ghost text — clears ghost state after acceptance", () => {
    // Simulate AI producing ghost text
    useAIStore.getState().setStreaming(true);
    useAIStore.getState().setGhostText("AI generated content");
    useAIStore.getState().setStreaming(false);

    // User accepts → ghost text captured, then cleared
    const accepted = useAIStore.getState().ghostText;
    expect(accepted).toBe("AI generated content");

    // Clear after acceptance
    useAIStore.getState().setGhostText(null);
    expect(useAIStore.getState().ghostText).toBeNull();
  });

  it("reject ghost text — simply clears ghost state", () => {
    useAIStore.getState().setStreaming(true);
    useAIStore.getState().setGhostText("Unwanted suggestion");
    useAIStore.getState().setStreaming(false);

    // User rejects → clear ghost text, nothing applied
    useAIStore.getState().setGhostText(null);

    expect(useAIStore.getState().ghostText).toBeNull();
    expect(useAIStore.getState().isStreaming).toBe(false);
  });

  it("provider settings integration — AI + Settings stores sync", () => {
    // Change AI provider
    useAIStore.getState().setProvider("openai");
    useAIStore.getState().setModel("gpt-4o");
    useAIStore.getState().setApiKey("sk-test-key");

    expect(useAIStore.getState().provider).toBe("openai");
    expect(useAIStore.getState().model).toBe("gpt-4o");
    expect(useAIStore.getState().apiKey).toBe("sk-test-key");

    // Settings store theme change doesn't affect AI store
    useSettingsStore.getState().setTheme("dark");
    expect(useSettingsStore.getState().theme).toBe("dark");
    expect(useAIStore.getState().provider).toBe("openai"); // unchanged

    // Switch provider back
    useAIStore.getState().setProvider("claude");
    useAIStore.getState().setModel("claude-sonnet-4-5-20250929");
    expect(useAIStore.getState().provider).toBe("claude");
  });
});

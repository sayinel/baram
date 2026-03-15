// §11.6 Agent Executor — sequential step execution with risk checks
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAgentStore } from "../../stores/agent-store";
import { executeAgentPlan } from "../agent-executor";

// Content with enough unchanged lines to keep risk low
const ORIGINAL_CONTENT = [
  "# My Document",
  "",
  "First paragraph with some text.",
  "Second paragraph continues here.",
  "Third paragraph is also present.",
  "Fourth paragraph rounds it out.",
  "Fifth paragraph for good measure.",
].join("\n");

const LOW_RISK_MODIFIED = [
  "# My Document",
  "",
  "First paragraph with some text.",
  "Second paragraph has been updated.",
  "Third paragraph is also present.",
  "Fourth paragraph rounds it out.",
  "Fifth paragraph for good measure.",
].join("\n");

const HIGH_RISK_MODIFIED =
  "Completely rewritten file with all new content here.";

describe("AgentExecutor", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
    vi.clearAllMocks();
  });

  it("executes a single step and produces diff", async () => {
    const readFileFn = vi.fn().mockResolvedValue(ORIGINAL_CONTENT);
    const llmFn = vi.fn().mockResolvedValue(LOW_RISK_MODIFIED);

    // Set up the agent store with a plan
    useAgentStore.getState().startPlanning("test");
    useAgentStore.getState().setPlan({
      steps: [
        { file: "test.md", action: "update", risk: "low", description: "fix" },
      ],
    });
    useAgentStore.getState().approvePlan();

    await executeAgentPlan({ readFileFn, llmFn });

    const state = useAgentStore.getState();
    expect(state.results).toHaveLength(1);
    expect(state.results[0].diff).toBeDefined();
    expect(state.status).toBe("completed");
  });

  it("pauses execution on medium/high risk", async () => {
    const readFileFn = vi.fn().mockResolvedValue(ORIGINAL_CONTENT);
    // Return completely different content to trigger high risk
    const llmFn = vi.fn().mockResolvedValue(HIGH_RISK_MODIFIED);

    useAgentStore.getState().startPlanning("test");
    useAgentStore.getState().setPlan({
      steps: [
        {
          file: "test.md",
          action: "update",
          risk: "low",
          description: "rewrite",
        },
      ],
    });
    useAgentStore.getState().approvePlan();

    await executeAgentPlan({ readFileFn, llmFn });

    const state = useAgentStore.getState();
    expect(state.status).toBe("paused");
  });

  it("tracks progress in agent store", async () => {
    const readFileFn = vi.fn().mockResolvedValue(ORIGINAL_CONTENT);
    const llmFn = vi.fn().mockResolvedValue(LOW_RISK_MODIFIED);

    useAgentStore.getState().startPlanning("test");
    useAgentStore.getState().setPlan({
      steps: [
        {
          file: "a.md",
          action: "update",
          risk: "low",
          description: "update a",
        },
        {
          file: "b.md",
          action: "update",
          risk: "low",
          description: "update b",
        },
      ],
    });
    useAgentStore.getState().approvePlan();

    await executeAgentPlan({ readFileFn, llmFn });

    const state = useAgentStore.getState();
    expect(state.completedSteps).toBe(2);
    expect(state.totalSteps).toBe(2);
    expect(state.status).toBe("completed");
  });
});

// §11.6 AgentStore — state machine for Agent Mode
import { beforeEach, describe, expect, it } from "vitest";

import { useAgentStore } from "../agent-store";

describe("AgentStore — state machine", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it("starts in idle state", () => {
    expect(useAgentStore.getState().status).toBe("idle");
  });

  it("transitions idle → planning on startPlanning()", () => {
    useAgentStore.getState().startPlanning("Improve all skills");
    expect(useAgentStore.getState().status).toBe("planning");
    expect(useAgentStore.getState().goal).toBe("Improve all skills");
  });

  it("transitions planning → reviewing on setPlan()", () => {
    useAgentStore.getState().startPlanning("test");
    useAgentStore
      .getState()
      .setPlan({ steps: [{ file: "a.md", action: "update", risk: "low" }] });
    expect(useAgentStore.getState().status).toBe("reviewing");
  });

  it("transitions reviewing → executing on approvePlan()", () => {
    useAgentStore.getState().startPlanning("test");
    useAgentStore
      .getState()
      .setPlan({ steps: [{ file: "a.md", action: "update", risk: "low" }] });
    useAgentStore.getState().approvePlan();
    expect(useAgentStore.getState().status).toBe("executing");
  });

  it("transitions executing → paused on pauseOnRisk()", () => {
    useAgentStore.getState().startPlanning("test");
    useAgentStore.getState().setPlan({ steps: [] });
    useAgentStore.getState().approvePlan();
    useAgentStore.getState().pauseOnRisk("High risk detected");
    expect(useAgentStore.getState().status).toBe("paused");
  });

  it("transitions executing → completed on finish()", () => {
    useAgentStore.getState().startPlanning("test");
    useAgentStore.getState().setPlan({ steps: [] });
    useAgentStore.getState().approvePlan();
    useAgentStore.getState().finish();
    expect(useAgentStore.getState().status).toBe("completed");
  });

  it("cancel() returns to idle from any state", () => {
    useAgentStore.getState().startPlanning("test");
    useAgentStore.getState().cancel();
    expect(useAgentStore.getState().status).toBe("idle");
  });

  it("tracks step completion progress", () => {
    useAgentStore.getState().startPlanning("test");
    useAgentStore.getState().setPlan({
      steps: [
        { file: "a.md", action: "update", risk: "low" },
        { file: "b.md", action: "update", risk: "low" },
      ],
    });
    useAgentStore.getState().approvePlan();
    useAgentStore.getState().completeStep(0, { diff: "+added" });
    expect(useAgentStore.getState().completedSteps).toBe(1);
    expect(useAgentStore.getState().totalSteps).toBe(2);
  });
});

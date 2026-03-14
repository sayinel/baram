// §11.6 Agent Panel — state-based UI for Agent Mode
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAgentStore } from "../../../stores/agent-store";
import { AgentPanel } from "../AgentPanel";

describe("AgentPanel", () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  it("shows goal input when idle", () => {
    useAgentStore.setState({ status: "idle" });
    render(<AgentPanel />);
    expect(screen.getByPlaceholderText(/목표/)).toBeInTheDocument();
  });

  it("shows plan review when in reviewing state", () => {
    useAgentStore.setState({
      status: "reviewing",
      plan: {
        steps: [
          { file: "a.md", action: "update", risk: "low", description: "test" },
        ],
      },
    });
    render(<AgentPanel />);
    expect(screen.getByText("a.md")).toBeInTheDocument();
    expect(screen.getByText("실행")).toBeInTheDocument();
  });

  it("shows progress bar when executing", () => {
    useAgentStore.setState({
      status: "executing",
      completedSteps: 2,
      totalSteps: 5,
    });
    render(<AgentPanel />);
    expect(screen.getByText("2/5")).toBeInTheDocument();
  });

  it("shows diff results when completed", () => {
    useAgentStore.setState({
      status: "completed",
      results: [{ file: "a.md", diff: "+line added", accepted: null }],
    });
    render(<AgentPanel />);
    expect(screen.getByText("전체 수락")).toBeInTheDocument();
  });
});

// §11.6 Agent Panel — top-level state-based view for Agent Mode
import { useCallback, useState } from "react";

import { useAgentStore } from "../../stores/agent-store";
import { AgentDiffView } from "./AgentDiffView";
import { AgentPlanView } from "./AgentPlanView";
import { AgentProgressBar } from "./AgentProgressBar";

export function AgentPanel() {
  const {
    status,
    plan,
    completedSteps,
    totalSteps,
    results,
    approvePlan,
    cancel,
    startPlanning,
  } = useAgentStore();
  const [goalInput, setGoalInput] = useState("");

  const handleSubmitGoal = useCallback(() => {
    const trimmed = goalInput.trim();
    if (trimmed) {
      startPlanning(trimmed);
      setGoalInput("");
    }
  }, [goalInput, startPlanning]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmitGoal();
      }
    },
    [handleSubmitGoal],
  );

  const handleAcceptAll = useCallback(() => {
    // Mark all results as accepted (future: apply changes to files)
    cancel();
  }, [cancel]);

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Agent Mode</h2>
        {status !== "idle" && (
          <button
            className="text-muted-foreground text-xs hover:underline"
            onClick={cancel}
            type="button"
          >
            취소
          </button>
        )}
      </div>

      {status === "idle" && (
        <div className="flex flex-col gap-2">
          <input
            className="border-input rounded border px-2 py-1.5 text-sm"
            onChange={(e) => setGoalInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="에이전트 목표를 입력하세요..."
            type="text"
            value={goalInput}
          />
          <button
            className="bg-primary text-primary-foreground rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            disabled={!goalInput.trim()}
            onClick={handleSubmitGoal}
            type="button"
          >
            시작
          </button>
        </div>
      )}

      {status === "planning" && (
        <div className="text-muted-foreground text-sm">계획 생성 중...</div>
      )}

      {status === "reviewing" && plan && (
        <AgentPlanView onApprove={approvePlan} plan={plan} />
      )}

      {status === "executing" && (
        <AgentProgressBar
          completedSteps={completedSteps}
          totalSteps={totalSteps}
        />
      )}

      {status === "paused" && (
        <div className="flex flex-col gap-2">
          <div className="text-sm text-yellow-600">
            위험이 감지되어 실행이 일시 중지되었습니다.
          </div>
          <AgentProgressBar
            completedSteps={completedSteps}
            totalSteps={totalSteps}
          />
        </div>
      )}

      {status === "completed" && results.length > 0 && (
        <AgentDiffView onAcceptAll={handleAcceptAll} results={results} />
      )}
    </div>
  );
}

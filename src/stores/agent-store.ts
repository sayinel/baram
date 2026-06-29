// §11.6 Agent Mode — state machine store
import { create } from "zustand";

export interface AgentPlan {
  steps: AgentStep[];
}

export type AgentStatus =
  "completed" | "executing" | "idle" | "paused" | "planning" | "reviewing";

export interface AgentStep {
  action: string;
  description?: string;
  file: string;
  risk: RiskLevel;
}

export type RiskLevel = "high" | "low" | "medium";

export interface StepResult {
  accepted?: boolean | null;
  diff: string;
  file?: string;
}

interface AgentState {
  /** Accept all results and return to idle */
  acceptAll: () => void;
  /** Approve the plan and start executing */
  approvePlan: () => void;
  /** Cancel agent — returns to idle from any state */
  cancel: () => void;
  /** Number of completed steps */
  completedSteps: number;
  /** Mark a step as completed with its result */
  completeStep: (index: number, result: StepResult) => void;
  /** Finish execution — transitions to completed */
  finish: () => void;
  /** User goal for the agent */
  goal: string;
  /** Pause execution due to risk */
  pauseOnRisk: (reason: string) => void;
  /** Pause reason (set on risk detection) */
  pauseReason: string;
  /** The plan with steps */
  plan: AgentPlan | null;
  /** Reset all state to initial values */
  reset: () => void;
  /** Per-step results (diffs) */
  results: StepResult[];
  /** Resume execution after pause */
  resume: () => void;
  /** Set the plan — transitions planning → reviewing */
  setPlan: (plan: AgentPlan) => void;
  /** Start planning with a goal — transitions idle → planning */
  startPlanning: (goal: string) => void;
  /** Current status in the state machine */
  status: AgentStatus;
  /** Total number of steps in the plan */
  totalSteps: number;
}

const initialState = {
  status: "idle" as AgentStatus,
  goal: "",
  plan: null as AgentPlan | null,
  completedSteps: 0,
  totalSteps: 0,
  results: [] as StepResult[],
  pauseReason: "",
};

export const useAgentStore = create<AgentState>()((set) => ({
  ...initialState,

  startPlanning: (goal: string) =>
    set({
      status: "planning",
      goal,
      plan: null,
      completedSteps: 0,
      totalSteps: 0,
      results: [],
      pauseReason: "",
    }),

  setPlan: (plan: AgentPlan) =>
    set({
      status: "reviewing",
      plan,
      totalSteps: plan.steps.length,
    }),

  approvePlan: () =>
    set({
      status: "executing",
      completedSteps: 0,
      results: [],
    }),

  completeStep: (index: number, result: StepResult) =>
    set((state) => {
      const results = [...state.results];
      results[index] = result;
      return {
        results,
        completedSteps: results.filter(Boolean).length,
      };
    }),

  pauseOnRisk: (reason: string) =>
    set({
      status: "paused",
      pauseReason: reason,
    }),

  resume: () =>
    set({
      status: "executing",
      pauseReason: "",
    }),

  finish: () =>
    set({
      status: "completed",
    }),

  acceptAll: () =>
    set((state) => ({
      ...initialState,
      results: state.results.map((r) => ({ ...r, accepted: true })),
    })),

  cancel: () =>
    set({
      ...initialState,
    }),

  reset: () =>
    set({
      ...initialState,
    }),
}));

// §11.6 Agent Plan View — step list with risk badges for plan review

import type { AgentPlan } from "../../stores/agent-store";

const RISK_BADGE_STYLES: Record<string, string> = {
  high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  medium:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

interface AgentPlanViewProps {
  onApprove: () => void;
  plan: AgentPlan;
}

export function AgentPlanView({ plan, onApprove }: AgentPlanViewProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">실행 계획</h3>
      <ul className="flex flex-col gap-2">
        {plan.steps.map((step, i) => (
          <li
            className="flex items-center gap-2 rounded border p-2 text-sm"
            key={`${step.file}-${i}`}
          >
            <span className="font-mono text-xs">{step.file}</span>
            <span className="text-muted-foreground text-xs">
              {step.description}
            </span>
            <span
              className={`ml-auto rounded px-1.5 py-0.5 text-xs font-medium ${RISK_BADGE_STYLES[step.risk] ?? ""}`}
            >
              {step.risk}
            </span>
          </li>
        ))}
      </ul>
      <button
        className="bg-primary text-primary-foreground rounded px-3 py-1.5 text-sm font-medium"
        onClick={onApprove}
        type="button"
      >
        실행
      </button>
    </div>
  );
}

// §11.6 Agent Diff View — inline diff per file with accept/reject

import type { StepResult } from "../../stores/agent-store";

interface AgentDiffViewProps {
  onAcceptAll: () => void;
  results: StepResult[];
}

export function AgentDiffView({ results, onAcceptAll }: AgentDiffViewProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">실행 결과</h3>
      <ul className="flex flex-col gap-2">
        {results.map((result, i) => (
          <li
            className="overflow-hidden rounded border text-sm"
            key={`result-${result.file ?? i}`}
          >
            {result.file && (
              <div className="bg-muted border-b px-2 py-1 font-mono text-xs">
                {result.file}
              </div>
            )}
            <pre className="max-h-40 overflow-auto p-2 text-xs">
              {result.diff}
            </pre>
          </li>
        ))}
      </ul>
      <button
        className="bg-primary text-primary-foreground rounded px-3 py-1.5 text-sm font-medium"
        onClick={onAcceptAll}
        type="button"
      >
        전체 수락
      </button>
    </div>
  );
}

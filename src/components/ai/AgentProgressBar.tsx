// §11.6 Agent Progress Bar — file-by-file execution status

interface AgentProgressBarProps {
  completedSteps: number;
  label?: string;
  totalSteps: number;
}

export function AgentProgressBar({
  completedSteps,
  label = "실행 중...",
  totalSteps,
}: AgentProgressBarProps) {
  const percent = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span>
          {completedSteps}/{totalSteps}
        </span>
      </div>
      <div className="bg-muted h-2 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

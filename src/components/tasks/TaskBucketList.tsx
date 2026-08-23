// §306 아젠다 버킷 하나 — 항목 렌더와 체크 토글
import type { TaskEntry } from "../../ipc/types";

import { overdueDays } from "../../utils/tasks/task-buckets";

interface Props {
  label: string;
  now: Date;
  onJump: (task: TaskEntry) => void;
  onToggle: (task: TaskEntry) => void;
  showOverdueAge: boolean;
  tasks: TaskEntry[];
  /** 링크 target → 노트 제목. 없으면 target을 그대로 보인다. */
  titleFor: (target: string) => string;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export function TaskBucketList({
  label,
  now,
  onJump,
  onToggle,
  showOverdueAge,
  tasks,
  titleFor,
}: Props) {
  if (tasks.length === 0) return null;

  return (
    <section className="task-bucket">
      <h3 className="task-bucket-header">
        {label} <span className="task-bucket-count">({tasks.length})</span>
      </h3>
      <ul className="task-bucket-list">
        {tasks.map((task) => {
          const age = showOverdueAge ? overdueDays(task, now) : 0;
          const shown = displayText(task.text, titleFor);
          return (
            <li className="task-row" key={`${task.path}:${task.line}`}>
              <input
                aria-label={shown}
                checked={task.state === "done"}
                className="task-row-check"
                onChange={() => onToggle(task)}
                type="checkbox"
              />
              <button
                className="btn-unstyled task-row-text"
                onClick={() => onJump(task)}
                type="button"
              >
                {shown}
              </button>
              {age > 0 && <span className="task-row-age">−{age}d</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 본문의 [[target]]을 현재 제목으로 바꿔 보여준다(§306). */
function displayText(text: string, titleFor: (t: string) => string): string {
  return text.replace(WIKILINK_RE, (_, inner: string) =>
    titleFor(inner.split("|")[0].trim()),
  );
}

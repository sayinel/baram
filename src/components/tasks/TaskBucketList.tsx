// §306 아젠다 버킷 하나 — 항목 렌더와 체크 토글
import type { TaskEntry } from "../../ipc/types";
import type { TaskBucket } from "../../utils/tasks/task-buckets";

import { overdueDays, taskAgeDays } from "../../utils/tasks/task-buckets";
import { priorityBadge } from "../../utils/tasks/task-filters";

interface Props {
  /** I3: "done"만 기본으로 접는다 — 그 외는 기본 펼침. */
  bucket: TaskBucket;
  label: string;
  now: Date;
  onJump: (task: TaskEntry) => void;
  onToggle: (task: TaskEntry) => void;
  /** §312 방치 배지를 보일지 — "예정 없음" 버킷에서만 켠다. */
  showAge: boolean;
  showOverdueAge: boolean;
  tasks: TaskEntry[];
  /** 링크 target → 노트 제목. 없으면 target을 그대로 보인다. */
  titleFor: (target: string) => string;
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** §312 이 일수 이상 방치된 항목에 배지를 붙인다. */
const STALE_DAYS = 30;

export function TaskBucketList({
  bucket,
  label,
  now,
  onJump,
  onToggle,
  showAge,
  showOverdueAge,
  tasks,
  titleFor,
}: Props) {
  if (tasks.length === 0) return null;

  return (
    // I3: 완료 목록은 vault 전체 완료 태스크를 모두 담을 수 있으므로(수천 개 규모)
    // 기본으로 접는다 — <details>는 가상 스크롤 없이도 그 <li>들을 마운트하지
    // 않게 한다. bucket이 리렌더 사이에 바뀌지 않으므로 이 초기값은 사용자가
    // 손으로 편 상태를 리렌더가 되돌리지 않는다.
    <details
      className="task-bucket"
      data-bucket={bucket}
      open={bucket !== "done"}
    >
      <summary className="task-bucket-header">
        {label} <span className="task-bucket-count">({tasks.length})</span>
      </summary>
      <ul className="task-bucket-list">
        {tasks.map((task) => {
          const age = showOverdueAge ? overdueDays(task, now) : 0;
          const ageDays = showAge ? taskAgeDays(task, now) : 0;
          const shown = displayText(task.text, titleFor);
          const priority = priorityBadge(task.priority);
          return (
            <li className="task-row" key={`${task.path}:${task.line}`}>
              <input
                aria-label={shown}
                checked={task.state === "done"}
                className="task-row-check"
                onChange={() => onToggle(task)}
                type="checkbox"
              />
              {priority && (
                <span
                  aria-label={priority.label}
                  // §308 .task-chip을 공유해 에디터 칩과 같은 아웃라인·반경·
                  // 색을 쓴다(같은 데이터가 두 표면에서 다르게 보이면 안 된다).
                  // task-row-priority는 .task-row 안에서의 레이아웃(flex-shrink)만 맡는다.
                  className="task-row-priority task-chip"
                  role="img"
                >
                  {priority.marker}
                </span>
              )}
              <button
                className="btn-unstyled task-row-text"
                onClick={() => onJump(task)}
                type="button"
              >
                {shown}
              </button>
              {age > 0 && <span className="task-row-age">−{age}d</span>}
              {showAge && ageDays >= STALE_DAYS && (
                <span className="task-row-age task-row-stale" title="Stale">
                  {ageDays}d
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/**
 * 본문의 [[target]] / [[target|alias]]를 표시 텍스트로 바꾼다. alias가 있으면
 * 사용자가 직접 붙인 그 표시를 우선한다 — titleFor(target)으로 덮어쓰면 그
 * 별칭을 조용히 버리게 된다.
 */
function displayText(text: string, titleFor: (t: string) => string): string {
  return text.replace(WIKILINK_RE, (_, inner: string) => {
    const [target, alias] = inner.split("|");
    return alias?.trim() || titleFor(target.trim());
  });
}

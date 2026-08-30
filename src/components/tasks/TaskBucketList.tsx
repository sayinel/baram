// §306 아젠다 버킷 하나 — 접기, 그리고 그 안의 행 목록.
//
// 행·메뉴·키는 `TaskRowList`가 갖는다. 여기 남는 것은 이 화면에만 있는 것 하나뿐이다:
// `<details>` 접기. 이동이 버킷 경계에서 멈추는 것은 그 목록의 클래스가 곧
// `AGENDA_ROW_SCOPE`이기 때문이고, 그래야 접힌 버킷을 건너뛰어 사용자가 보지 못한 행에
// 포커스가 가는 일이 없다.
import type { TaskEntry } from "../../ipc/types";
import type { TaskBucket } from "../../utils/tasks/task-buckets";

import { TaskRowList } from "./TaskRowList";

interface Props {
  /** I3: "done"만 기본으로 접는다 — 그 외는 기본 펼침. */
  bucket: TaskBucket;
  label: string;
  now: Date;
  onJump: (task: TaskEntry) => void;
  onToggle: (task: TaskEntry) => void;
  /** §312 정리 메뉴에서 고른 항목 — 무엇을 할지는 `runTaskTriageAction`이 정한다. */
  onTriage: (task: TaskEntry, action: string) => void;
  /** §312 방치 배지를 보일지 — "예정 없음" 버킷에서만 켠다. */
  showAge: boolean;
  showLateDays: boolean;
  tasks: TaskEntry[];
  /** 링크 target → 노트 제목. 없으면 target을 그대로 보인다. */
  titleFor: (target: string) => string;
}

export function TaskBucketList({
  bucket,
  label,
  now,
  onJump,
  onToggle,
  onTriage,
  showAge,
  showLateDays,
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
      <TaskRowList
        now={now}
        onJump={onJump}
        onToggle={onToggle}
        onTriage={onTriage}
        showAge={showAge}
        showLateDays={showLateDays}
        tasks={tasks}
        titleFor={titleFor}
      />
    </details>
  );
}

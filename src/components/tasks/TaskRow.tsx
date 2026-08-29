// §306/§315 태스크 한 줄 — 아젠다 버킷과 주간 리뷰가 **같은 행**을 쓴다.
//
// 두 화면이 각자 행을 그리면 갈라지는 것은 모양이 아니라 계약이다: 체크박스가 어느
// 콜백을 타는지, 우선순위 라벨이 접근성 트리에 남는지, 어떤 키가 어떤 조작인지. 이
// 코드베이스가 반복해서 대가를 치른 종류의 중복이라 처음부터 한 곳에 둔다.

import type { TaskEntry } from "../../ipc/types";

import { useTranslation } from "../../i18n/useTranslation";
import { overdueDays, taskAgeDays } from "../../utils/tasks/task-buckets";
import { priorityBadge } from "../../utils/tasks/task-filters";
import { displayText } from "../../utils/tasks/task-row-display";
import { TASK_ROW_KEYSHORTCUTS } from "../../utils/tasks/task-row-keys";

/** §312 이 일수 이상 방치된 항목에 배지를 붙인다. */
const STALE_DAYS = 30;

interface Props {
  /** 이 행의 정리 메뉴가 열려 있는가 — `aria-expanded`가 그것을 말한다 */
  menuOpen: boolean;
  now: Date;
  onJump: (task: TaskEntry) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLLIElement>, task: TaskEntry) => void;
  onOpenMenu: (row: HTMLElement, task: TaskEntry) => void;
  onToggle: (task: TaskEntry) => void;
  /** §312 방치 배지를 보일지 — "예정 없음"에서만 켠다 */
  showAge: boolean;
  showOverdueAge: boolean;
  task: TaskEntry;
  /** 링크 target → 노트 제목. 없으면 target을 그대로 보인다 */
  titleFor: (target: string) => string;
}

export function TaskRow({
  menuOpen,
  now,
  onJump,
  onKeyDown,
  onOpenMenu,
  onToggle,
  showAge,
  showOverdueAge,
  task,
  titleFor,
}: Props) {
  const { t } = useTranslation();
  const age = showOverdueAge ? overdueDays(task, now) : 0;
  const ageDays = showAge ? taskAgeDays(task, now) : 0;
  const shown = displayText(task.text, titleFor);
  const priority = priorityBadge(task.priority);

  return (
    <li
      // 메뉴 자체는 role="menu"까지 갖췄지만 진입점이 아무 말도 하지 않으면
      // 보조기술 사용자는 메뉴가 있다는 사실에 도달할 방법이 없다.
      aria-expanded={menuOpen}
      aria-haspopup="menu"
      // 키 경로가 있다는 사실 자체가 보조기술에 도달해야 한다 — 메뉴의 힌트는
      // 메뉴를 연 사람만 본다.
      aria-keyshortcuts={TASK_ROW_KEYSHORTCUTS}
      className="task-row"
      // §306 우선순위는 이 속성 하나로 표현된다 — 행 왼쪽 거터의 세로 레일을
      // CSS가 그린다(tasks.css). 값의 글자는 `TaskPriorityLevel`과 같아야 한다.
      data-priority={priority?.level}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu(e.currentTarget, task);
      }}
      onKeyDown={(e) => onKeyDown(e, task)}
      tabIndex={0}
    >
      <input
        aria-label={shown}
        checked={task.state === "done"}
        className="task-row-check"
        onChange={() => onToggle(task)}
        // 체크 판정의 키는 메뉴에 없다(체크박스는 메뉴 항목이 아니다) — 그래서
        // 그 키를 알리는 자리가 여기다.
        title={t("tasks.triage.checkHint")}
        type="checkbox"
      />
      {priority && (
        // 레일은 `::before`라 보조기술에 존재하지 않는다 — 낱말 라벨이 여기
        // 남아야 스크린 리더가 우선순위를 읽는다.
        //
        // ‼️ `aria-label`을 단 빈 `<span>`이 아니라 **감춘 텍스트**다. 이름을
        // 붙일 내용이 없는 요소의 `aria-label`은 브라우저가 무시할 수 있고
        // (이 패널이 이미 한 번 겪었다 — 그래서 종전 코드에 `role="img"`가
        // 있었다), 그 우회 자체가 "그릴 것이 없으면 텍스트로 두라"는 신호였다.
        <span className="visually-hidden">{priority.label}</span>
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
}

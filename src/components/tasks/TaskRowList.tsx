// §306/§307 태스크 행 목록 하나 — 목록 하나가 메뉴 하나와 이동 범위 하나를 갖는다.
//
// 아젠다 버킷 · 노트별 섹션 · 허브 섹션이 이것을 쓴다. 주간 리뷰는 쓰지 않는다: 그 화면은
// 섹션 여럿에 걸쳐 **메뉴 하나·이동 범위 하나**를 갖는 구조라(세 묶음을 한 흐름으로 훑는
// 것이 그 화면의 목적이다) "목록 하나가 메뉴 하나"라는 이 계약으로 표현되지 않는다.
// 그쪽과 공유되는 것은 `use-task-row-keys.ts`다.
import type { TaskEntry } from "../../ipc/types";

import { useTranslation } from "../../i18n/useTranslation";
import { buildTriageItems } from "../../utils/tasks/task-triage";
import { TaskRow } from "./TaskRow";
import { TaskRowMenu } from "./TaskRowMenu";
import { useTaskRowKeys } from "./use-task-row-keys";
import { useTaskRowMenu } from "./use-task-row-menu";

interface Props {
  now: Date;
  onJump: (task: TaskEntry) => void;
  onToggle: (task: TaskEntry) => void;
  /** §312 정리 메뉴에서 고른 항목 — 무엇을 할지는 `runTaskTriageAction`이 정한다. */
  onTriage: (task: TaskEntry, action: string) => void;
  /** §312 방치 배지를 보일지 — "예정 없음" 버킷에서만 켠다. */
  showAge?: boolean;
  showLateDays?: boolean;
  tasks: TaskEntry[];
  /** 링크 target → 노트 제목. 없으면 target을 그대로 보인다. */
  titleFor: (target: string) => string;
}

export function TaskRowList({
  now,
  onJump,
  onToggle,
  onTriage,
  showAge = false,
  showLateDays = false,
  tasks,
  titleFor,
}: Props) {
  const { t } = useTranslation();
  const { closeMenu, dismissMenu, menu, openMenu } = useTaskRowMenu(tasks);
  const onKeyDown = useTaskRowKeys({
    onOpenMenu: openMenu,
    onToggle,
    onTriage,
  });

  return (
    <>
      {/* 클래스가 곧 이동 범위다(`AGENDA_ROW_SCOPE`) — `j`/`k`가 이 목록 안에서 멈춘다. */}
      <ul className="task-bucket-list">
        {tasks.map((task) => (
          <TaskRow
            key={`${task.path}:${task.line}`}
            menuOpen={
              menu?.task.path === task.path && menu.task.line === task.line
            }
            now={now}
            onJump={onJump}
            onKeyDown={onKeyDown}
            onOpenMenu={openMenu}
            onToggle={onToggle}
            showAge={showAge}
            showLateDays={showLateDays}
            task={task}
            titleFor={titleFor}
          />
        ))}
      </ul>
      {menu && (
        // <li> **밖**에 둔다 — 안에 두면 메뉴의 keydown이 행 핸들러로 올라가
        // 같은 j/k가 항목과 행 포커스를 함께 옮긴다.
        <TaskRowMenu
          // 항목은 메뉴가 열려 있는 동안에만 필요하다 — 3~5개짜리 배열이라 memo가
          // 값어치를 하지 않고, 여기서 만들어야 항목이 `menu.task`를 볼 수 있다
          // (`#someday`는 라벨이 그 태스크의 태그에 달린 토글이다).
          items={buildTriageItems(t, menu.task)}
          menu={menu}
          onAction={(action) => {
            closeMenu();
            onTriage(menu.task, action);
          }}
          onClose={closeMenu}
          onDismiss={dismissMenu}
        />
      )}
    </>
  );
}

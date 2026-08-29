// §306 아젠다 버킷 하나 — 접기, 그리고 이 버킷 **안에서만** 도는 키 이동.
//
// 행 자체는 `TaskRow`, 메뉴 수명은 `useTaskRowMenu`가 갖는다. 여기 남는 것은 이 화면에만
// 있는 것 둘뿐이다: `<details>` 접기와 이동 범위.
import { useCallback } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { TaskBucket } from "../../utils/tasks/task-buckets";

import { useTranslation } from "../../i18n/useTranslation";
import { moveRowFocus } from "../../utils/tasks/task-row-focus";
import { resolveTaskRowKey } from "../../utils/tasks/task-row-keys";
import { buildTriageItems } from "../../utils/tasks/task-triage";
import { TaskRow } from "./TaskRow";
import { TaskRowMenu } from "./TaskRowMenu";
import { useTaskRowMenu } from "./use-task-row-menu";

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
  showOverdueAge: boolean;
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
  showOverdueAge,
  tasks,
  titleFor,
}: Props) {
  const { t } = useTranslation();
  const { closeMenu, dismissMenu, menu, openMenu } = useTaskRowMenu(tasks);

  // §312 "네 조작 모두 키 한 번으로". 어떤 키가 무엇인지는 `task-row-keys.ts`의 표가
  // 정하고 — §315(주간 리뷰)가 그 표를 그대로 물려받는다 — 여기서는 그 판정을 **이 화면의
  // 범위로** 실행한다: 이동은 버킷 안에서만 멈춘다. 접힌 버킷을 건너뛰어 다음 버킷으로
  // 넘어가면 사용자가 보지 못한 행에 포커스가 간다(버킷을 가로지르는 이동은 목록 전체를
  // 한 흐름으로 보여 주는 §315의 몫이다).
  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLLIElement>, task: TaskEntry) => {
      const action = resolveTaskRowKey({
        altKey: e.altKey,
        code: e.code,
        ctrlKey: e.ctrlKey,
        // ‼️ `isComposing`은 React 합성 이벤트에 **없다** — `nativeEvent`에서 꺼낸다.
        // 합성 이벤트를 통째로 넘기면 그 필드가 선택이라 타입은 통과하고 IME 관문만
        // 조용히 꺼진다(다이얼로그 셋이 `e.nativeEvent.isComposing`을 쓰는 이유).
        isComposing: e.nativeEvent.isComposing,
        key: e.key,
        keyCode: e.keyCode,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      });
      if (!action) return;
      e.preventDefault();
      switch (action.kind) {
        case "focus":
          moveRowFocus(e.currentTarget, action.delta);
          break;
        case "menu":
          openMenu(e.currentTarget, task);
          break;
        case "triage":
          // ‼️ 체크 판정은 체크박스와 **같은 콜백**을 탄다. 여기서 디스패처로 따로 보내면
          // 같은 판정에 진입점이 둘이 되고, 그 둘이 갈라지는 순간 한쪽만 고쳐진다.
          if (action.action === "check") onToggle(task);
          else onTriage(task, action.action);
          break;
      }
    },
    [onToggle, onTriage, openMenu],
  );

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
        {tasks.map((task) => (
          <TaskRow
            key={`${task.path}:${task.line}`}
            menuOpen={
              menu?.task.path === task.path && menu.task.line === task.line
            }
            now={now}
            onJump={onJump}
            onKeyDown={handleRowKeyDown}
            onOpenMenu={openMenu}
            onToggle={onToggle}
            showAge={showAge}
            showOverdueAge={showOverdueAge}
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
          // (Task 3의 `#someday`는 라벨이 그 태스크의 태그에 달린 토글이다).
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
    </details>
  );
}

// §306 아젠다 버킷 하나 — 항목 렌더와 체크 토글, §312 정리 메뉴
import { useCallback, useEffect, useRef, useState } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { TaskBucket } from "../../utils/tasks/task-buckets";
import type { TaskMenuState } from "./TaskRowMenu";

import { useTranslation } from "../../i18n/useTranslation";
import { overdueDays, taskAgeDays } from "../../utils/tasks/task-buckets";
import { priorityBadge } from "../../utils/tasks/task-filters";
import {
  resolveTaskRowKey,
  TASK_ROW_KEYSHORTCUTS,
} from "../../utils/tasks/task-row-keys";
import { buildTriageItems } from "../../utils/tasks/task-triage";
import { TaskRowMenu } from "./TaskRowMenu";

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

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** §312 이 일수 이상 방치된 항목에 배지를 붙인다. */
const STALE_DAYS = 30;

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
  const [menu, setMenu] = useState<null | TaskMenuState>(null);
  // 메뉴를 연 행 — 닫을 때 포커스를 돌려줄 곳이다. 키보드 사용자가 `d`로 열고
  // Escape로 닫았을 때 포커스가 body로 떨어지면 그 다음 `j`가 아무 데도 닿지 않는다.
  const openerRef = useRef<HTMLElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenu(null);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!menu) return;
    // ‼️ click이 아니라 mousedown이다. 우클릭은 click을 내지 않으므로, click으로
    // 닫으면 다른 버킷의 행을 우클릭했을 때 메뉴가 둘 다 열린 채로 남는다.
    // mousedown은 좌·우클릭 모두 contextmenu보다 먼저 오므로 "먼저 닫고 다시
    // 연다"가 자연스럽게 성립한다. 여기서는 포커스를 돌려주지 않는다 — 사용자가
    // 방금 누른 다른 곳에서 포커스를 뺏어 오게 된다.
    const close = () => setMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menu, closeMenu]);

  // ‼️ 메뉴는 자기 행보다 오래 살면 안 된다. 워처의 자동 새로고침·다른 버킷의 체크박스
  // 토글·필터 입력이 전부 `tasks`를 갈아끼우는데, 그때 메뉴를 그대로 두면 화면에 없는
  // 행의 옛 좌표에 떠 있고 그 항목을 실행하면 보이지 않는 태스크에 쓰기가 나간다.
  // 게다가 그 상태의 Escape는 이미 **분리된** opener에 focus()를 걸어 포커스를 body로
  // 떨어뜨린다 — 그래서 여기서는 `closeMenu`가 아니라 `setMenu(null)`이다.
  useEffect(() => {
    if (!menu) return;
    const alive = tasks.some(
      (x) => x.path === menu.task.path && x.line === menu.task.line,
    );
    if (!alive) setMenu(null);
  }, [tasks, menu]);

  const openMenu = useCallback((row: HTMLElement, task: TaskEntry) => {
    openerRef.current = row;
    const rect = row.getBoundingClientRect();
    // ‼️ 여기서 최종 좌표를 정하지 않는다 — 이 시점에 메뉴는 아직 렌더되지 않아
    // 높이를 알 수 없고, 그 높이는 항목 라벨이 감기는 정도에 따라 달라진다. 그래서
    // 넘기는 것은 **행의 사각형**이고, 화면 안으로 끌어들이는 일은 메뉴가 자기를
    // 재고 나서 한다(`useMenuPlacement`).
    setMenu({
      anchor: { bottom: rect.bottom, left: rect.left, top: rect.top },
      task,
    });
  }, []);

  // §312 "네 조작 모두 키 한 번으로". 어떤 키가 무엇인지는 `task-row-keys.ts`의 표가
  // 정하고 — §315(주간 리뷰)가 그 표를 그대로 물려받는다 — 여기서는 그 판정을 **이 화면의
  // 범위로** 실행한다: 이동은 버킷 안에서만 멈춘다(버킷을 가로지르는 이동은 목록 전체를
  // 소유한 §315의 몫이다).
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
        {tasks.map((task) => {
          const age = showOverdueAge ? overdueDays(task, now) : 0;
          const ageDays = showAge ? taskAgeDays(task, now) : 0;
          const shown = displayText(task.text, titleFor);
          const priority = priorityBadge(task.priority);
          return (
            <li
              // 메뉴 자체는 role="menu"까지 갖췄지만 진입점이 아무 말도 하지 않으면
              // 보조기술 사용자는 메뉴가 있다는 사실에 도달할 방법이 없다.
              aria-expanded={
                menu?.task.path === task.path && menu.task.line === task.line
              }
              aria-haspopup="menu"
              // 키 경로가 있다는 사실 자체가 보조기술에 도달해야 한다 — 메뉴의 힌트는
              // 메뉴를 연 사람만 본다.
              aria-keyshortcuts={TASK_ROW_KEYSHORTCUTS}
              className="task-row"
              key={`${task.path}:${task.line}`}
              onContextMenu={(e) => {
                e.preventDefault();
                openMenu(e.currentTarget, task);
              }}
              onKeyDown={(e) => handleRowKeyDown(e, task)}
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
                <span
                  aria-label={priority.label}
                  // §308 방향 C — 알약이 사라지며 에디터의 .task-chip과의 클래스
                  // 공유도 끝났다. task-row-priority가 조용한 타이포그래피
                  // (--color-text-muted)와 .task-row 안 레이아웃(flex-shrink)을
                  // 스스로 갖는다(tasks.css).
                  className="task-row-priority"
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
          onDismiss={() => setMenu(null)}
        />
      )}
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

/** 같은 버킷 목록 안에서 이웃 행으로 포커스를 옮긴다. 끝에서는 멈춘다. */
function moveRowFocus(from: HTMLElement, delta: number): void {
  const list = from.closest(".task-bucket-list");
  if (!list) return;
  const rows = [...list.querySelectorAll<HTMLElement>("li.task-row")];
  rows[rows.indexOf(from) + delta]?.focus();
}

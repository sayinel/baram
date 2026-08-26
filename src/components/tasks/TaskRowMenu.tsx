// §312 아젠다 행 정리 메뉴 — `file-tree-context-menu.tsx`의 모양(위치 state prop +
// 별도 액션 디스패처)을 그대로 따른다. 에디터의 `toolbar/ContextMenu.tsx`는 노드 타입
// 감지가 붙어 있어 여기엔 과하다.
//
// 다른 점은 하나다: 항목을 JSX에 박지 않고 **데이터로 받는다**. Task 3(#someday)·
// Task 4(삭제)가 이 컴포넌트를 다시 쓰지 않고 `buildTriageItems`에 줄만 더하게
// 하려는 것이다. 그 목록은 액션 id를 푸는 `task-triage.ts`에 산다 — 항목과
// 디스패처의 case는 같은 계약이고, 떨어져 있으면 한쪽만 늘어난다.
import { useEffect, useId, useRef, useState } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { TaskMenuItem } from "../../utils/tasks/task-triage";

import { useTranslation } from "../../i18n/useTranslation";

export interface TaskMenuState {
  task: TaskEntry;
  x: number;
  y: number;
}

export interface TaskRowMenuProps {
  items: TaskMenuItem[];
  menu: TaskMenuState;
  onAction: (action: string) => void;
  /** Escape로 닫는다 — 포커스를 연 행으로 되돌린다. */
  onClose: () => void;
  /**
   * 포커스가 메뉴 밖으로 나갔다 — 닫되 포커스는 **건드리지 않는다**.
   *
   * `onClose`와 갈라져 있어야 하는 이유가 정확히 하나 있다: `onClose`는 포커스를 연
   * 행으로 되돌리는데, 그것을 blur에도 쓰면 Tab이 제자리를 맴돈다 — 사용자가 방금
   * 옮겨 간 곳에서 포커스를 도로 빼앗기 때문이다.
   */
  onDismiss: () => void;
}

export function TaskRowMenu({
  items,
  menu,
  onAction,
  onClose,
  onDismiss,
}: TaskRowMenuProps): React.JSX.Element {
  const { t } = useTranslation();
  const baseId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  // §315가 요구하는 키보드 경로의 전제 — 열리자마자 메뉴가 키를 받는다. 항목마다
  // tabIndex를 돌리는 대신 컨테이너 하나가 포커스를 갖고 `aria-activedescendant`로
  // 강조를 알린다(WAI-ARIA menu 패턴).
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const itemId = (index: number) => `${baseId}-${index}`;

  const move = (delta: number) =>
    setActive((i) => (i + delta + items.length) % items.length);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // 행에도 keydown 핸들러가 있다(d·j·k) — 그리로 새면 메뉴 안에서 누른 j가
    // 항목과 행 포커스를 함께 옮긴다.
    e.stopPropagation();
    switch (e.key) {
      case " ":
      case "Enter":
        e.preventDefault();
        // 비활성 항목은 실행하지 않되 **건너뛰지도 않는다** — 강조가 그 위에 설 수 있어야
        // 라벨에 적힌 "왜 안 되는지"를 키보드로도 읽는다(WAI-ARIA menu).
        if (!items[active].disabled) onAction(items[active].id);
        break;
      case "ArrowDown":
      case "j":
        e.preventDefault();
        move(1);
        break;
      case "ArrowUp":
      case "k":
        e.preventDefault();
        move(-1);
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  return (
    <div
      aria-activedescendant={itemId(active)}
      aria-label={t("tasks.triage.menu")}
      className="task-row-menu"
      // ‼️ 바깥 mousedown 리스너(TaskBucketList)는 **포인터 경로만** 덮는다. 키보드로
      // 열어 Tab으로 빠져나가면 그 리스너는 한 번도 불리지 않아 메뉴가 열린 채 남고,
      // 다른 버킷에서 하나 더 열면 화면에 메뉴가 둘이 된다. 포커스가 메뉴를 떠나는
      // 것이 "닫아야 한다"의 정확한 조건이고, WAI-ARIA menu 패턴이 요구하는 조건이기도
      // 하다. `relatedTarget`이 메뉴 안이면(항목 사이 이동) 닫지 않는다.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onDismiss();
      }}
      // 바깥 mousedown이 메뉴를 닫는다(TaskBucketList). 메뉴 안에서 시작한
      // mousedown까지 거기로 새면 click이 항목에 닿기 전에 메뉴가 사라진다.
      onKeyDown={handleKeyDown}
      onMouseDown={(e) => e.stopPropagation()}
      ref={ref}
      role="menu"
      style={{ left: menu.x, top: menu.y }}
      tabIndex={-1}
    >
      {items.map((item, index) => (
        <div
          aria-disabled={item.disabled || undefined}
          className={itemClass(item, index === active)}
          id={itemId(index)}
          key={item.id}
          onClick={() => {
            if (!item.disabled) onAction(item.id);
          }}
          onMouseEnter={() => setActive(index)}
          role="menuitem"
        >
          <span>{item.label}</span>
          {/* 키 힌트는 장식이 아니라 **발견 가능성**이다 — 이것이 없으면 t·s·Del은
              아무도 찾을 수 없는 단축키가 되고, 그러면 affordance가 아니다.
              ‼️ `aria-hidden`이다: 보조기술에는 행의 `aria-keyshortcuts`가 이미
              같은 사실을 알린다. 여기서 한 번 더 읽히면 항목의 접근 가능한 이름이
              "Due today T"가 되어 항목 이름이 키캡으로 오염된다. */}
          {item.hint && (
            <span aria-hidden="true" className="task-row-menu-hint">
              {item.hint}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * 항목의 클래스 — 강조(active)·파괴적(danger)·비활성(disabled)은 **서로 독립**이다.
 * 삼항 하나로 묶으려 들면 강조된 파괴적 항목에서 한쪽이 사라진다.
 */
function itemClass(item: TaskMenuItem, active: boolean): string {
  return [
    "task-row-menu-item",
    active && "task-row-menu-item-active",
    item.danger && "task-row-menu-item-danger",
    item.disabled && "task-row-menu-item-disabled",
  ]
    .filter(Boolean)
    .join(" ");
}

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
  onClose: () => void;
}

export function TaskRowMenu({
  items,
  menu,
  onAction,
  onClose,
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
        onAction(items[active].id);
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
          className={
            index === active
              ? "task-row-menu-item task-row-menu-item-active"
              : "task-row-menu-item"
          }
          id={itemId(index)}
          key={item.id}
          onClick={() => onAction(item.id)}
          onMouseEnter={() => setActive(index)}
          role="menuitem"
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

// §312 행 컨텍스트 메뉴의 수명 — 여는 자리, 닫는 자리, 그리고 **행보다 오래 살지 않기**.
//
// 아젠다 버킷과 주간 리뷰가 같은 메뉴를 쓴다. 아래 세 effect는 전부 "메뉴가 자기 행보다
// 오래 살면 무엇이 깨지는가"에 대한 답이라, 화면마다 다시 쓰면 그중 하나는 반드시 빠진다.

import { useCallback, useEffect, useRef, useState } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { TaskMenuState } from "./TaskRowMenu";

export interface TaskRowMenu {
  closeMenu: () => void;
  /** 바깥 클릭·항목이 사라짐 — 포커스를 **돌려주지 않고** 닫는다 */
  dismissMenu: () => void;
  menu: null | TaskMenuState;
  openMenu: (row: HTMLElement, task: TaskEntry) => void;
}

/**
 * `tasks`는 지금 화면에 있는 목록이다. 메뉴가 가리키는 항목이 그 목록에서 사라지면
 * 메뉴도 함께 닫는다 — 아래 세 번째 effect가 그 판정이다.
 */
export function useTaskRowMenu(tasks: TaskEntry[]): TaskRowMenu {
  const [menu, setMenu] = useState<null | TaskMenuState>(null);
  // 메뉴를 연 행 — 닫을 때 포커스를 돌려줄 곳이다. 키보드 사용자가 `d`로 열고
  // Escape로 닫았을 때 포커스가 body로 떨어지면 그 다음 `j`가 아무 데도 닿지 않는다.
  const openerRef = useRef<HTMLElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenu(null);
    openerRef.current?.focus();
  }, []);

  const dismissMenu = useCallback(() => setMenu(null), []);

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

  return { closeMenu, dismissMenu, menu, openMenu };
}

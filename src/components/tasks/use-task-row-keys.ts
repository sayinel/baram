// §312 태스크 행의 키 조작 — 표는 `task-row-keys.ts`가 갖고, 그 판정을 **실행**하는
// 배선이 여기 있다.
//
// 이 배선이 화면마다 한 벌씩 있었다: 아젠다 버킷과 주간 리뷰가 같은 switch를 각자 갖고
// 있었고, §307 A·C가 세 번째·네 번째 사본이 될 참이었다. 갈라지는 것은 모양이 아니라
// 계약이다 — 어떤 키가 어떤 조작인지, IME 조합 중에 무엇이 막히는지, 체크가 정리
// 디스패처를 타는지 체크박스와 같은 콜백을 타는지.
//
// 화면마다 **다른 것은 둘뿐**이라 인자로 받는다: 이동이 멈추는 범위(`scope`), 그리고
// 조작 직전에 할 일(`onBeforeTriage` — §315의 자동 전진이 행 위치를 적는다).
import { useCallback } from "react";

import type { TaskEntry } from "../../ipc/types";

import { moveRowFocus } from "../../utils/tasks/task-row-focus";
import { resolveTaskRowKey } from "../../utils/tasks/task-row-keys";

interface Options {
  /** §315 정리 조작 직전 — 목록이 갱신된 뒤 포커스를 돌려줄 자리를 적어 둔다. */
  onBeforeTriage?: (row: HTMLElement) => void;
  onOpenMenu: (row: HTMLElement, task: TaskEntry) => void;
  onToggle: (task: TaskEntry) => void;
  onTriage: (task: TaskEntry, action: string) => void;
  /** `j`/`k` 이동이 멈추는 범위. 기본은 아젠다의 한 버킷(`AGENDA_ROW_SCOPE`). */
  scope?: string;
}

export function useTaskRowKeys({
  onBeforeTriage,
  onOpenMenu,
  onToggle,
  onTriage,
  scope,
}: Options) {
  return useCallback(
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
          moveRowFocus(e.currentTarget, action.delta, scope);
          break;
        case "menu":
          onOpenMenu(e.currentTarget, task);
          break;
        case "triage":
          onBeforeTriage?.(e.currentTarget);
          // ‼️ 체크 판정은 체크박스와 **같은 콜백**을 탄다. 여기서 디스패처로 따로 보내면
          // 같은 판정에 진입점이 둘이 되고, 그 둘이 갈라지는 순간 한쪽만 고쳐진다.
          if (action.action === "check") onToggle(task);
          else onTriage(task, action.action);
          break;
      }
    },
    [onBeforeTriage, onOpenMenu, onToggle, onTriage, scope],
  );
}

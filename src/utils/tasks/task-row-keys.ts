// §312 아젠다 행의 키 바인딩 표 — "네 판정 모두 아젠다에서 **키 한 번**으로".
//
// 표를 컴포넌트 밖에 두는 이유가 둘 있다:
//
// 1. §315(주간 리뷰)가 같은 행 모델 위에 얹힌다. 거기서 바인딩을 새로 정의하면 같은 키가
//    두 화면에서 다른 일을 하게 된다 — 물려받을 표가 하나 있어야 한다.
// 2. 이동은 **델타만** 돌려주고 범위는 호출자가 정한다. 버킷 하나를 소유한
//    `TaskBucketList`는 버킷 안에서 멈추고, 목록 전체를 소유하는 §315는 버킷을 가로지를 수
//    있다. 범위를 표에 박으면 §315가 이 표를 대체해야 한다.
//
// ‼️ 파괴적 판정만 글자키가 아니다. `Delete`/`Backspace`는 실수로 스치기 어렵고, 되돌릴 수
// 없는 조작에서 그 차이가 오타 하나와 잃어버린 줄 하나를 가른다. 어느 쪽이든 확인 관문은
// 조작 안에 있으므로(`confirmAndDeleteTaskLine`) 키 경로가 관문을 우회하지 않는다.

import { layoutKey } from "../../extensions/plugins/vim/core/keys";

export type TaskRowKeyAction =
  | { action: string; kind: "triage" }
  | { delta: number; kind: "focus" }
  | { kind: "menu" };

/**
 * `resolveTaskRowKey`가 보는 것 — React 이벤트 전체가 아니라 이 필드들뿐이다.
 *
 * `code`/`keyCode`/`isComposing`이 선택인 이유는 서로 다르다:
 * - `code`는 한글 배열 폴백에만 필요하고, 라틴 배열에서는 `key`만으로 충분하다.
 * - `keyCode`는 폐기된 필드다 — 내지 않는 환경이 있어도 `isComposing`이 남는다.
 * - `isComposing`은 **React 합성 이벤트에 없다.** 호출부가 `nativeEvent`에서 꺼내
 *   넘긴다(다이얼로그 셋이 `e.nativeEvent.isComposing`을 쓰는 것과 같은 이유).
 */
export interface TaskRowKeyEvent {
  altKey: boolean;
  code?: string;
  ctrlKey: boolean;
  isComposing?: boolean;
  key: string;
  keyCode?: number;
  metaKey: boolean;
  shiftKey: boolean;
}

/**
 * 보조기술에 알리는 키 목록(`aria-keyshortcuts`). 네 판정과 메뉴 키를 담는다 —
 * j/k는 방향키의 별칭이라 "단축키"가 아니다.
 *
 * ‼️ 이 문자열과 아래 표가 갈리면 이 목록은 거짓말이 된다. `task-row-keys.test.ts`가
 * 목록의 모든 키가 실제로 동작하는지 확인한다.
 */
export const TASK_ROW_KEYSHORTCUTS = "X T S Delete Backspace D";

/**
 * 정리 액션 id → 키 라벨. 메뉴가 이것을 항목 옆에 그려 키 경로를 **발견 가능하게** 한다 —
 * 아무도 찾을 수 없는 키보드 경로는 affordance가 아니다.
 *
 * 키캡은 번역하지 않는다(문서의 단축키 표와 같은 표기).
 */
export const TASK_ROW_KEY_HINT: Record<string, string> = {
  check: "X",
  delete: "Del",
  dueToday: "T",
  someday: "S",
};

/**
 * 행에서 누른 키를 행이 할 일로 푼다. 표에 없으면 `null`(호출자는 손대지 않는다).
 *
 * ‼️ 수식키가 붙은 것은 앱 단축키다(Cmd+K 등). 여기서 삼키면 행에 포커스가 있는 동안 그
 * 단축키가 통째로 죽는다 — 실제로 `k` 하나만 보던 시절 Cmd+K가 행 이동으로 먹혔다.
 */
export function resolveTaskRowKey(e: TaskRowKeyEvent): null | TaskRowKeyAction {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  // ‼️ 조합 중 keydown은 IME의 것이지 이 행의 것이 아니다 — 조합을 확정하려고 누른 키가
  // 판정으로 새면 사용자가 내리지 않은 판정이 나간다. `Delete`/`Backspace`도 예외가
  // 아니다: 어떤 입력기도 그 둘을 가져가지 않아 조합 중에도 그대로 도착하므로, 여기서
  // 걸러 내지 않으면 IME가 살아 있는 동안 **되돌릴 수 없는 조작만** 반응한다.
  if (e.isComposing || e.keyCode === 229) return null;
  // 한글 배열에서 `x`는 `ㅌ`로 도착한다(기기 확인: `vim-code-block-boundary.ts`). 위
  // 관문만으로는 못 잡는다 — `src/spike/ime-probe`의 2026-07-26 raw 로그상 이 WKWebView의
  // 한글 입력은 조합 이벤트를 하나도 내지 않기 때문이다(`cm-instance.ts:112`). 판정 규칙은
  // §298 vim 코어의 `layoutKey`를 그대로 쓴다: "한글 문자 + 평범한 글자 물리 키"일 때만
  // 라틴 글자로 되돌리므로 dvorak 재배치와 shift 기호는 손대지 않는다.
  switch (layoutKey(e)) {
    case "ArrowDown":
    case "j":
      return { delta: 1, kind: "focus" };
    case "ArrowUp":
    case "k":
      return { delta: -1, kind: "focus" };
    case "Backspace":
    case "Delete":
      return { action: "delete", kind: "triage" };
    case "d":
      return { kind: "menu" };
    case "s":
      return { action: "someday", kind: "triage" };
    case "t":
      return { action: "dueToday", kind: "triage" };
    case "x":
      return { action: "check", kind: "triage" };
    default:
      return null;
  }
}

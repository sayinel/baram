// §274.1 선택 팝업이 보이는 영역 밖으로 나가지 않도록 위치를 물린다.
//
// 앵커는 선택 영역의 오른쪽-아래 모서리다(use-pdf-selection-popup.ts) — 방금
// 드래그를 끝낸 자리에 팝업이 따라붙는 것이 자연스럽기 때문이다. 하지만 그
// 자리가 페이지 오른쪽 여백에 가까우면 팝업 폭(스와치 5개 + 액션 버튼들,
// ~250px)이 통째로 창 밖으로 나가 잘린다.
//
// 순수 함수로 분리한 이유: 실제 위치 보정은 getBoundingClientRect에 의존하는데
// jsdom은 모든 요소에 0 rect를 돌려주므로 DOM 경로는 단위 테스트가 불가능하다.
// 결정 로직만 여기로 빼면 경계 조건을 전부 고정할 수 있다.

export interface PopupBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface PopupSize {
  height: number;
  width: number;
}

/** 경계에서 띄울 최소 여백(px). */
export const POPUP_EDGE_MARGIN = 8;

/**
 * 뷰포트 좌표계에서, `desired` 위치에 `size` 크기의 팝업을 놓되 `bounds`
 * 안에 완전히 들어오도록 물린 좌표를 돌려준다.
 *
 * 뒤집기(flip)가 아니라 물리기(clamp)를 쓴다: 아래로 안 들어가면 위로
 * 뒤집는 편이 보기 좋지만, 그러려면 "피해야 할 선택 영역의 위쪽 경계"를
 * 알아야 하고 앵커에는 그 정보가 없다(아래쪽 모서리 하나뿐이다). 물리기는
 * 그 정보 없이도 **절대 잘리지 않음**을 보장한다 — 아래 경계에서는 팝업이
 * 선택 영역 마지막 줄과 겹칠 수 있다는 것이 대가다.
 *
 * ‼️ 팝업이 경계보다 크면(아주 좁은 창) 물릴 방법이 없다. 그 경우 시작
 * 모서리(left/top)에 맞춘다 — 반대쪽으로 물리면 사용자가 첫 컨트롤(색
 * 스와치)조차 못 보게 된다.
 */
export function clampPopupToBounds({
  bounds,
  desired,
  margin = POPUP_EDGE_MARGIN,
  size,
}: {
  bounds: PopupBounds;
  desired: { left: number; top: number };
  margin?: number;
  size: PopupSize;
}): { left: number; top: number } {
  return {
    left: clampAxis(
      desired.left,
      size.width,
      bounds.left,
      bounds.right,
      margin,
    ),
    top: clampAxis(desired.top, size.height, bounds.top, bounds.bottom, margin),
  };
}

function clampAxis(
  desired: number,
  extent: number,
  min: number,
  max: number,
  margin: number,
): number {
  const lo = min + margin;
  const hi = max - margin - extent;
  // hi < lo이면 팝업이 경계보다 크다 — 시작 모서리에 맞춘다(위 doc comment).
  if (hi < lo) return lo;
  return Math.min(Math.max(desired, lo), hi);
}

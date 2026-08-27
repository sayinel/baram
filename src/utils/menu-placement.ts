// §312 화면 안에 들어오는 컨텍스트 메뉴 좌표.
//
// `position: fixed` 메뉴는 뷰포트 좌표계에 그대로 놓이므로, 앵커의 좌표를 그냥 쓰면
// 창 아래쪽 행에서 메뉴가 창 밖으로 잘린다(사용자 신고 + 스크린샷). 잘리지 않게 하는
// 규칙은 패널마다 다를 이유가 없다 — "메뉴는 화면 안에 있어야 한다"는 디자인 선택이
// 아니라 한 가지 사실이다. 그래서 산술만 여기 한 곳에 둔다: 태스크 정리 메뉴
// (`TaskRowMenu`, 행 사각형에 붙는다)와 파일 트리 컨텍스트 메뉴
// (`FileTreeContextMenu`, 커서 점에 붙는다)가 같은 함수를 탄다. 점은 높이 0인
// 사각형이므로 두 경우가 하나의 앵커 타입으로 덮인다.
//
// ‼️ 두 메뉴의 **스타일시트**는 여전히 공유하지 않는다(tasks.css의 `.task-row-menu`
// 주석 참고) — 한쪽 패널의 모양을 손볼 때 다른 패널이 조용히 따라 움직이면 안 된다.
// 공유하는 것은 좌표 계산뿐이고, 이 파일은 DOM도 React도 모른다.

/** 메뉴가 붙는 곳. 커서 점 앵커는 `top === bottom`으로 넣는다. */
export interface MenuAnchor {
  /** 앵커의 아래 모서리 — 메뉴는 기본으로 여기서 시작한다. */
  bottom: number;
  left: number;
  /** 앵커의 위 모서리 — 아래에 자리가 없을 때 메뉴는 여기서 끝난다. */
  top: number;
}

export interface MenuSize {
  height: number;
  width: number;
}

export interface MenuViewport {
  height: number;
  width: number;
}

/** 창 가장자리와의 최소 간격. 그림자(--shadow-md)가 숨 쉴 만큼만 둔다. */
export const MENU_VIEWPORT_MARGIN = 4;

/**
 * 앵커·측정된 메뉴 크기·뷰포트로부터 메뉴의 최종 좌표를 정한다.
 *
 * 규칙은 세 줄이다.
 * 1. 세로: 아래에 들어가면 아래. 아니면 위로 **뒤집는다**(메뉴 아래끝이 앵커 윗변에
 *    닿는다 — 뒤집혀도 그 행에 붙어 있다). 양쪽 다 안 되면 아래 여백에 맞춰 세운다.
 * 2. 메뉴가 창보다 **높으면** 1의 마지막 갈래가 음수 y를 내므로, 그때는 위 여백에
 *    고정한다. 머리가 아니라 발을 자르는 쪽이다 — 항목은 자주 쓰는 것이 위, 되돌릴 수
 *    없는 것이 아래이므로 화면에 남길 쪽은 위다. (메뉴를 스크롤시키지 않는 이유:
 *    강조가 `aria-activedescendant`라 스크롤 컨테이너가 생기면 j/k로 옮긴 강조가
 *    보이지 않는 곳으로 나간다 — 결함을 다른 결함으로 바꾸는 것이다.)
 * 3. 가로: 앵커 왼쪽에 맞추되, 오른쪽으로 넘치면 오른쪽 여백에 맞춰 **민다**(오른쪽
 *    정렬로 뒤집지 않는다 — 앵커가 행 전체 폭이라 뒤집으면 행과 아무 관계 없어 보인다).
 *    창보다 넓으면 왼쪽 여백에 고정한다.
 *
 * 어느 갈래에서도 메뉴는 앵커의 세로줄·가로줄을 벗어나지 않는다: 잘리는 메뉴보다
 * 나쁜 것은 엉뚱한 구석으로 튀는 메뉴다.
 */
export function placeMenu(
  anchor: MenuAnchor,
  size: MenuSize,
  viewport: MenuViewport,
  margin: number = MENU_VIEWPORT_MARGIN,
): { x: number; y: number } {
  // 여백을 지키며 놓을 수 있는 가장 아래/오른쪽 좌표. 메뉴가 창보다 크면 음수가 되고,
  // 그때 `Math.max(margin, …)`가 "위/왼쪽 여백에 고정"이라는 갈래를 만든다.
  const lastY = viewport.height - margin - size.height;
  const lastX = viewport.width - margin - size.width;
  const above = anchor.top - size.height;
  // 뒤집는 조건은 "아래에 안 들어가고 **위에는 들어간다**" 하나뿐이다. 그 밖의 모든
  // 경우는 아래 배치를 여백 안으로 끌어들이는 것으로 끝난다 — 앵커 자체가 화면 위로
  // 밀려 나가 있는 경우(스크롤로 반쯤 잘린 행)까지 이 clamp가 덮는다.
  const flip = anchor.bottom > lastY && above >= margin;
  return {
    x: clamp(anchor.left, margin, lastX),
    y: flip ? above : clamp(anchor.bottom, margin, lastY),
  };
}

/** `hi < lo`(메뉴가 창보다 큼)이면 `lo`가 이긴다 — 위/왼쪽을 남긴다. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), Math.max(lo, hi));
}

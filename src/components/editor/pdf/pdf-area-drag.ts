// §276.3 영역 하이라이트 드래그 — 순수 기하만. pdfjs도 React도 몰라야
// 단위 테스트가 레이아웃 없이 가능하다(pdf-highlight-hittest.ts의 같은
// 원칙). 실제 PDF user space 변환은 여기서 재구현하지 않고 clientRectToPdf
// (Task 6, pdf-highlight-geom.ts)를 그대로 재사용한다 — 이 파일이 만드는
// 건 그 함수가 원하는 형태(DOMRectLike)로 두 드래그 지점을 정규화하는
// 것뿐이다.
import type { DOMRectLike } from "./pdf-highlight-geom";

/** 뷰포트(client) 기준 한 점. */
export interface DragPoint {
  x: number;
  y: number;
}

/**
 * 실시간 미리보기 렌더링용 — 페이지 로컬(.pdf-page 기준) CSS 픽셀로 두
 * 점을 정규화한다. rectFromDragPoints와 다른 함수를 새로 만들지 않고, 두
 * 점을 pageOrigin만큼 미리 옮긴 뒤 그 함수에 넘긴다 — "두 점으로 사각형을
 * 만드는" 규칙이 한 곳에만 있다.
 */
export function localRectFromDragPoints(
  p0: DragPoint,
  p1: DragPoint,
  pageOrigin: { left: number; top: number },
): DOMRectLike {
  return rectFromDragPoints(
    { x: p0.x - pageOrigin.left, y: p0.y - pageOrigin.top },
    { x: p1.x - pageOrigin.left, y: p1.y - pageOrigin.top },
  );
}

/**
 * 드래그의 시작/현재(또는 종료) 두 점을 사각형으로 정규화한다. 방향(위→아래,
 * 아래→위, 좌→우, 우→좌 어느 쪽으로 드래그했든) 과 무관하게 항상 같은
 * 사각형을 돌려준다 — clientRectToPdf가 기대하는 형태와 동일한 raw client
 * 좌표(pageOrigin을 아직 빼지 않은)다.
 */
export function rectFromDragPoints(p0: DragPoint, p1: DragPoint): DOMRectLike {
  return {
    height: Math.abs(p1.y - p0.y),
    left: Math.min(p0.x, p1.x),
    top: Math.min(p0.y, p1.y),
    width: Math.abs(p1.x - p0.x),
  };
}

/** 이 값 미만으로 움직인 드래그는 "클릭"으로 본다 — 아무것도 만들지 않고
 * 조용히 취소한다(§276.3, 모드 중 실수로 클릭했을 때 0-size 하이라이트가
 * 생기는 것을 막는다). */
export const MIN_DRAG_SIZE_PX = 4;

/** rect의 너비/높이 중 하나라도 임계값 이상이면 "실제 드래그"로 본다. */
export function isMeaningfulDrag(rect: DOMRectLike): boolean {
  return rect.width >= MIN_DRAG_SIZE_PX || rect.height >= MIN_DRAG_SIZE_PX;
}

// §396 전체 화면 뷰어(Mermaid · SVG · 이미지 · 라이트박스)의 배율 모델과 줌 주인 스택.
// 설계: dev/design/specs/0077-fullscreen-viewer-zoom-design.md
//
// 순수 모듈이다(React · DOM 없음). 에디터 줌(`zoom.ts` 의 0.5~2.0, 문서 전체 배율)과
// 범위가 달라 따로 둔다 — 뷰어는 0.5~8 이고 값이 설정에 영속되지 않는다. 줌 입력을
// 받는 `use-zoom.ts` 는 `topZoomOwner()` 가 null 이 아니면 에디터 대신 그 주인에게 넘긴다.

export const VIEWER_ZOOM_MIN = 0.5;
export const VIEWER_ZOOM_MAX = 8;
export const VIEWER_ZOOM_STOPS: readonly number[] = [
  0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 6, 8,
];

/** 단계 비교의 부동소수점 허용 오차 — 단계 값 근처의 찌꺼기가 단계를 건너뛰게 하지 않는다. */
const EPS = 1e-6;

/** 휠 한 칸당 지수 감도. `exp(-deltaY * k)` 라서 +d 와 -d 가 서로 정확히 되돌린다. */
const WHEEL_SENSITIVITY = 0.005;

export interface ViewerRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface ZoomAnchor {
  clientX: number;
  clientY: number;
}

export interface ZoomOwner {
  getScale(): number;
  setScale(scale: number, anchor: null | ZoomAnchor): void;
}

const owners: ZoomOwner[] = [];

/**
 * 기준점 아래의 내용 지점이 배율 변경 뒤에도 같은 화면 좌표에 남도록 스크롤을 얼마나
 * 옮길지 돌려준다. 기준점이 내용 밖이면 가장자리 비율(0 또는 1)로 자른다.
 */
export function anchoredScrollDelta(
  before: ViewerRect,
  after: ViewerRect,
  anchor: ZoomAnchor,
): { dx: number; dy: number } {
  const fx = fractionOf(anchor.clientX, before.left, before.width);
  const fy = fractionOf(anchor.clientY, before.top, before.height);
  return {
    dx: after.left + fx * after.width - anchor.clientX,
    dy: after.top + fy * after.height - anchor.clientY,
  };
}

export function clampViewerScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.max(VIEWER_ZOOM_MIN, Math.min(VIEWER_ZOOM_MAX, scale));
}

/** 가로/세로 비율이 `aspect` 인 내용을 `box` 안에 비율을 지켜 가장 크게 넣는다. */
export function fitWithin(
  box: { height: number; width: number },
  aspect: null | number,
): { height: number; width: number } {
  if (aspect === null || !Number.isFinite(aspect) || aspect <= 0) {
    return { height: box.height, width: box.width };
  }
  if (box.width / box.height > aspect) {
    return { height: box.height, width: box.height * aspect };
  }
  return { height: box.width / aspect, width: box.width };
}

/** 현재 값보다 엄격히 큰(`1`) 또는 작은(`-1`) 첫 단계. 없으면 끝값. */
export function nextViewerZoomStop(scale: number, direction: -1 | 1): number {
  if (direction === 1) {
    const up = VIEWER_ZOOM_STOPS.find((stop) => stop > scale + EPS);
    return up ?? VIEWER_ZOOM_MAX;
  }
  const down = VIEWER_ZOOM_STOPS.filter((stop) => stop < scale - EPS).at(-1);
  return down ?? VIEWER_ZOOM_MIN;
}

/** 가장 나중에 등록된 주인이 줌 입력을 받는다. 반환값은 자기 항목만 지우는 멱등 해제 함수. */
export function pushZoomOwner(owner: ZoomOwner): () => void {
  owners.push(owner);
  return () => {
    const index = owners.lastIndexOf(owner);
    if (index !== -1) owners.splice(index, 1);
  };
}

export function topZoomOwner(): null | ZoomOwner {
  return owners.at(-1) ?? null;
}

/** 휠 `deltaY` 를 곱셈 배율로. 위로 굴리면(음수) 확대한다. 비유한 입력은 1(변화 없음). */
export function viewerWheelFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY)) return 1;
  return Math.exp(-deltaY * WHEEL_SENSITIVITY);
}

function fractionOf(point: number, start: number, length: number): number {
  if (!(length > 0)) return 0.5;
  return Math.max(0, Math.min(1, (point - start) / length));
}

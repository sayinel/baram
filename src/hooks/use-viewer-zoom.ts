// §396 전체 화면 뷰어 하나의 배율. 마운트되는 동안 줌 주인으로 올라가 `use-zoom.ts` 가 넘기는
// 입력을 받고, 배율을 스크롤 컨테이너의 속성 · CSS 변수로 쓴다.
// 설계: dev/design/specs/0077-fullscreen-viewer-zoom-design.md (D1 · D3)
//
// DOM 계약 — 화면별 CSS 가 기대는 것: 배율 s ≠ 1 이면 스크롤 컨테이너에 `data-viewer-zoomed` 속성과
// `--viewer-zoom-width` · `--viewer-zoom-height`(px, 맞춤 × s). s = 1 이면 셋 다 없다 — 100% 의
// 모양은 오늘의 CSS 가 정한다. 크기를 내용 요소가 아니라 컨테이너에 쓰는 이유: svg 는
// `dangerouslySetInnerHTML` 로 들어와 마크업이 바뀔 때마다 새 요소가 되고, 요소에 쓴 인라인 스타일은
// 그때 사라진다.
//
// 맞춤은 내용 요소의 상자가 아니라 s = 1 에서 그 상자 안에 그려지는 그림이다(`fitWithin(상자, 고유 비율)`).
// Mermaid · SVG 보기 모달의 svg 는 `width: 100%` · `max-height: 100%` 라(mermaid.css · svg-block.css)
// 그림이 화면보다 세로로 길면 상자는 화면 폭을 다 차지하고, 그림은 `viewBox` 비율로 그 안 가운데에
// 좌우 띠를 두고 그려진다 — 상자를 키우면 빈 띠까지 스크롤하게 된다.

import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { ViewerRect, ZoomAnchor } from "../utils/viewer-zoom";

import {
  anchoredScrollDelta,
  clampViewerScale,
  fitWithin,
  nextViewerZoomStop,
  pushZoomOwner,
  VIEWER_ZOOM_MAX,
  VIEWER_ZOOM_MIN,
} from "../utils/viewer-zoom";

export interface ViewerZoom {
  canZoomIn: boolean;
  canZoomOut: boolean;
  reset(): void;
  scale: number;
  scrollRef: (el: HTMLElement | null) => void;
  zoomIn(): void;
  zoomOut(): void;
}

export interface ViewerZoomOptions {
  /** 바뀌면 같은 배율로 맞춤 크기를 다시 잰다(내용 교체 · 프리뷰 → 원본). */
  contentKey?: unknown;
  /** 스크롤 컨테이너 안에서 크기를 받을 요소의 선택자. 폭이 0 보다 큰 첫 일치를 쓴다. */
  contentSelector: string;
  /** 바뀌면 배율을 1 로(라이트박스 넘기기). */
  resetKey?: unknown;
  /** false 면 주인으로 등록은 하되 입력을 버린다(G1). 기본 true. */
  zoomable?: boolean;
}

interface Size {
  height: number;
  width: number;
}

/** 한 번 만들어진 주인 · 콜백이 읽는 상태. 렌더마다 바뀌는 옵션도 여기로 옮겨 둔다. */
interface ZoomState {
  /** 지금 쓰여 있는 변수의 맞춤 크기. 속성이 있을 때만 뜻이 있다(`applyScale` 참고). */
  fit: null | Size;
  observer: null | ResizeObserver;
  scale: number;
  scroller: HTMLElement | null;
  selector: string;
  zoomable: boolean;
}

const ZOOMED_ATTR = "data-viewer-zoomed";
const WIDTH_VAR = "--viewer-zoom-width";
const HEIGHT_VAR = "--viewer-zoom-height";

/** 단위 없는 숫자 또는 `px` 길이. 다른 단위(`em` · `%` …)는 고유 크기가 아니다. */
const ABSOLUTE_LENGTH_RE = /^\s*(\d+(?:\.\d*)?|\.\d+)(?:px)?\s*$/i;

export function useViewerZoom({
  contentKey,
  contentSelector,
  resetKey,
  zoomable = true,
}: ViewerZoomOptions): ViewerZoom {
  const [scale, setScale] = useState(1);
  const stateRef = useRef<ZoomState>({
    fit: null,
    observer: null,
    scale: 1,
    scroller: null,
    selector: contentSelector,
    zoomable,
  });
  stateRef.current.selector = contentSelector;
  stateRef.current.zoomable = zoomable;

  const request = useCallback((next: number, anchor: null | ZoomAnchor) => {
    const state = stateRef.current;
    if (!state.zoomable) return;
    if (applyScale(state, next, anchor)) setScale(state.scale);
  }, []);

  // 등록은 첫 입력보다 먼저 끝나야 해서 layout effect 다(spec D1). 주인 객체는 등록마다 새로 만든다 —
  // `pushZoomOwner` 의 해제는 `lastIndexOf(owner)` 로 찾으므로, 같은 객체를 두 번 올리면 낡은 해제가
  // 새 항목을 지운다. effect 가 해제 함수를 그대로 돌려주어 정리에서 정확히 한 번 부른다.
  useLayoutEffect(
    () =>
      pushZoomOwner({
        getScale: () => stateRef.current.scale,
        setScale: request,
      }),
    [request],
  );

  // 라이트박스 넘기기(`resetKey`), 동영상으로 바뀜(`zoomable` 이 꺼짐) → 1. `zoomable` 을 보지 않는
  // `applyScale` 을 직접 부른다 — 꺼진 뒤의 되돌림이 그 관문에 막히면 안 된다. 마운트 때는 이미 1 이다.
  useLayoutEffect(() => {
    if (applyScale(stateRef.current, 1, null)) setScale(1);
  }, [resetKey, zoomable]);

  useLayoutEffect(() => {
    remeasure(stateRef.current);
  }, [contentKey]);

  const scrollRef = useCallback((el: HTMLElement | null) => {
    const state = stateRef.current;
    state.observer?.disconnect();
    state.observer = null;
    state.scroller = el;
    if (!el) return;
    // jsdom 에는 ResizeObserver 가 없다 — 그때는 컨테이너 크기 변화에 다시 재지 않는다.
    if (typeof ResizeObserver === "function") {
      state.observer = new ResizeObserver(() => remeasure(stateRef.current));
      state.observer.observe(el);
    }
    // 확대한 채 컨테이너가 바뀌면 새 컨테이너도 계약을 받는다. 배율 1 이면 아무것도 하지 않는다.
    remeasure(state);
  }, []);

  const zoomIn = useCallback(
    () => request(nextViewerZoomStop(stateRef.current.scale, 1), null),
    [request],
  );
  const zoomOut = useCallback(
    () => request(nextViewerZoomStop(stateRef.current.scale, -1), null),
    [request],
  );
  const reset = useCallback(() => request(1, null), [request]);

  return {
    canZoomIn: zoomable && scale < VIEWER_ZOOM_MAX,
    canZoomOut: zoomable && scale > VIEWER_ZOOM_MIN,
    reset,
    scale,
    scrollRef,
    zoomIn,
    zoomOut,
  };
}

function absoluteLength(value: null | string): number {
  const match = value === null ? null : ABSOLUTE_LENGTH_RE.exec(value);
  return match ? Number(match[1]) : NaN;
}

/**
 * 배율을 `requested`(잘라서)로 바꾸고 DOM 을 이 호출 안에서 고친다. 배율이 바뀌었으면 true.
 *
 * DOM 을 동기로 쓰는 이유: 제스처 · 휠 이벤트는 프레임마다 온다. 크기를 React 렌더에 맡기면 그 사이
 * 도착한 다음 이벤트가 재는 "확대 전" 사각형은 아직 쓰이지 않은 배율의 것이라 낡고, 기준점이 미끄러진다.
 * 그래서 확대 전 그림을 재고 → 쓰고 → 다시 재서 기준점이 제자리에 남게 스크롤한다. 내용이 아직 없으면
 * (Mermaid 가 그리는 중) 배율만 바꾸고 속성을 걷어 둔다 — 쓰는 일은 `contentKey` 의 다시 재기가 한다.
 */
function applyScale(
  state: ZoomState,
  requested: number,
  anchor: null | ZoomAnchor,
): boolean {
  const next = clampViewerScale(requested);
  if (next === state.scale) return false;
  state.scale = next;
  const { scroller } = state;
  if (!scroller) return true;
  const content = findContent(scroller, state.selector);
  if (!content) {
    clearZoomDom(scroller);
    return true;
  }
  const before = drawnRect(content);
  // 속성을 쓰는 곳은 `writeZoomDom` 하나고, 그 두 호출부(이 함수 · `remeasure`)가 쓰기 직전에
  // `state.fit` 을 정한다. 속성이 없으면 내용이 배율 1 의 크기라서 방금 잰 그림이 곧 맞춤이다.
  const fit =
    scroller.hasAttribute(ZOOMED_ATTR) && state.fit
      ? state.fit
      : { height: before.height, width: before.width };
  state.fit = fit;
  writeZoomDom(scroller, fit, next);
  keepAnchor(scroller, before, content, anchor);
  return true;
}

function clearZoomDom(scroller: HTMLElement): void {
  scroller.removeAttribute(ZOOMED_ATTR);
  scroller.style.removeProperty(WIDTH_VAR);
  scroller.style.removeProperty(HEIGHT_VAR);
}

/** 내용 요소의 상자 안에 고유 비율로 그려지는 사각형. svg 의 기본 `xMidYMid meet` 처럼 가운데에 둔다. */
function drawnRect(content: Element): ViewerRect {
  const box = content.getBoundingClientRect();
  const size = fitWithin(box, intrinsicAspect(content));
  return {
    height: size.height,
    left: box.left + (box.width - size.width) / 2,
    top: box.top + (box.height - size.height) / 2,
    width: size.width,
  };
}

function findContent(scroller: HTMLElement, selector: string): Element | null {
  return (
    Array.from(scroller.querySelectorAll(selector)).find(
      (el) => el.getBoundingClientRect().width > 0,
    ) ?? null
  );
}

/** svg 는 `viewBox`, 없으면 단위 없는 · px `width` · `height` 속성. img 는 원본 픽셀. 모르면 null. */
function intrinsicAspect(el: Element): null | number {
  if (el instanceof HTMLImageElement) {
    return positiveRatio(el.naturalWidth, el.naturalHeight);
  }
  if (el instanceof SVGSVGElement) {
    const viewBox = el
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/);
    const fromViewBox =
      viewBox?.length === 4
        ? positiveRatio(Number(viewBox[2]), Number(viewBox[3]))
        : null;
    return (
      fromViewBox ??
      positiveRatio(
        absoluteLength(el.getAttribute("width")),
        absoluteLength(el.getAttribute("height")),
      )
    );
  }
  return null;
}

/**
 * 크기를 바꾼 뒤 — 바꾸기 전 그림 `before` 에서 기준점 아래 있던 지점이 다시 기준점에 오게 스크롤한다.
 * 기준점이 null 이면(키 · 버튼) 스크롤 컨테이너의 가운데.
 */
function keepAnchor(
  scroller: HTMLElement,
  before: ViewerRect,
  content: Element,
  anchor: null | ZoomAnchor,
): void {
  const frame = scroller.getBoundingClientRect();
  const { dx, dy } = anchoredScrollDelta(
    before,
    drawnRect(content),
    anchor ?? {
      clientX: frame.left + frame.width / 2,
      clientY: frame.top + frame.height / 2,
    },
  );
  scroller.scrollLeft += dx;
  scroller.scrollTop += dy;
}

function positiveRatio(width: number, height: number): null | number {
  const ratio = width / height;
  return width > 0 && height > 0 && Number.isFinite(ratio) ? ratio : null;
}

/**
 * 컨테이너 크기나 내용이 바뀐 뒤 같은 배율로 맞춤을 다시 잰다. 크기 지정이 남아 있으면 배율 1 의
 * 상자를 잴 수 없으므로 걷고 → 재고 → 다시 쓴다, 한 동기 블록 안에서(그 사이에 페인트가 끼지 않는다).
 *
 * 걷는 순간 내용이 배율 1 로 줄어 스크롤 범위가 줄고, 그 뒤의 측정이 레이아웃을 돌려 scrollLeft · Top 을
 * 줄어든 범위로 자를 것으로 본다(WKWebView 에서 확인하지 않았다) — 그러면 다시 써도 스크롤은 돌아오지
 * 않는다(편집 전체화면은 내용이 바뀔 때마다 svg 가 새로 온다). 그래서 걷기 전 그림에서 컨테이너 가운데
 * 아래의 지점을 잡아 두고, 다시 쓴 뒤 그 지점을 가운데로 되돌린다. 자르지 않았고 맞춤도 그대로면 이동량은 0 이다.
 */
function remeasure(state: ZoomState): void {
  const { scroller } = state;
  if (!scroller || state.scale === 1) return;
  const shown = scroller.hasAttribute(ZOOMED_ATTR)
    ? findContent(scroller, state.selector)
    : null;
  const before = shown ? drawnRect(shown) : null;
  clearZoomDom(scroller);
  const content = findContent(scroller, state.selector);
  if (!content) return;
  const drawn = drawnRect(content);
  state.fit = { height: drawn.height, width: drawn.width };
  writeZoomDom(scroller, state.fit, state.scale);
  if (before) keepAnchor(scroller, before, content, null);
}

function writeZoomDom(scroller: HTMLElement, fit: Size, scale: number): void {
  if (scale === 1) {
    clearZoomDom(scroller);
    return;
  }
  scroller.setAttribute(ZOOMED_ATTR, "");
  scroller.style.setProperty(WIDTH_VAR, `${fit.width * scale}px`);
  scroller.style.setProperty(HEIGHT_VAR, `${fit.height * scale}px`);
}

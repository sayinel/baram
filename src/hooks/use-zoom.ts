// §4.2 Editor content zoom — trackpad pinch + Cmd+/Cmd-/Cmd+0
//
// Applies CSS zoom to .editor-area-scroll — this zooms both the editor content
// AND overlay components (BlockHandle, TableInsertButtons, FloatingToolbar, etc.)
// together, keeping their coordinates aligned at any zoom level.
// CSS zoom on this container creates a containing block for position:fixed
// descendants, so overlay positions are relative to the scroll area (correct).
// Persists zoom level in settings store.
//
// The settings store is the single source of truth for the level, and this hook
// subscribes to it — so a zoom request that never touches this window still lands.
// The HTML preview needs that: its document sits in a sandboxed opaque-origin frame
// that swallows the keystrokes and wheel events the listeners below are waiting for,
// and forwards them over postMessage instead (see HtmlPreview.tsx).

import { useEffect } from "react";

import type { Editor } from "@tiptap/react";

import { useSettingsStore } from "../stores/settings/store";
import { clampZoomLevel } from "../utils/zoom";

// §281 WKWebView 트랙패드 핀치 — Safari GestureEvent 경로. 표준이 아니라
// lib.dom에 타입이 없다. 우리가 읽는 필드만 좁게 선언한다.
interface SafariGestureEvent extends Event {
  /** 제스처 시작 대비 **누적** 배율. 시작 시 1.0, 벌리면 > 1. */
  readonly scale: number;
}

const KEYBOARD_STEP = 0.1;
const PINCH_SENSITIVITY = 0.005;

export function useZoom(editor: Editor | null): void {
  // Apply the persisted level on mount, then follow the store. Subscribing rather
  // than applying inline at each call site is what lets zoom requests originating
  // outside this window (the preview bridge) reach the DOM through one path.
  useEffect(() => {
    let applied = useSettingsStore.getState().zoomLevel;
    if (applied !== 1) applyZoom(applied, editor);

    const unsubscribe = useSettingsStore.subscribe((state) => {
      if (state.zoomLevel === applied) return;
      applied = state.zoomLevel;
      applyZoom(applied, editor);
    });

    // The scroll container may not exist yet on first mount; observe for it.
    // §perf-large-file C3.4: resolve via editor.view.dom.closest() when the
    // editor is available; fall back to document.querySelector for the brief
    // window before the editor mounts.
    const observer = new MutationObserver(() => {
      const el =
        editor?.view.dom.closest(".editor-area-scroll") ??
        document.querySelector(".editor-area-scroll");
      if (el) {
        const lvl = useSettingsStore.getState().zoomLevel;
        if (lvl !== 1) applyZoom(lvl, editor);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      unsubscribe();
      observer.disconnect();
      cancelReflow();
    };
  }, [editor]);

  // Trackpad pinch + keyboard shortcuts.
  //
  // ‼️ 핀치는 두 가지 경로로 온다. ctrl+wheel은 Chrome/Windows 규약이고,
  // WKWebView(Safari 엔진)는 Safari 고유의 GestureEvent를 보낸다. 이 앱이
  // 실제로 도는 곳은 WKWebView다 — 아래 gesture 경로가 없으면 트랙패드
  // 핀치가 사실상 동작하지 않는다. 측정 근거는 handleGestureChange 위 주석.
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // 제스처가 진행 중이면 무시한다 — WKWebView는 같은 물리적 동작에 대해
      // gesture 이벤트와 ctrl+wheel을 **둘 다** 보낸다(같은 타임스탬프로
      // 관측됨). 둘 다 적용하면 한 번의 핀치가 두 번 반영된다.
      if (gestureActive) return;
      e.preventDefault();
      zoomByWheel(e.deltaY);
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      // Cmd+= / Cmd++ → zoom in
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        zoomIn();
        return;
      }

      // Cmd+- → zoom out
      if (e.key === "-") {
        e.preventDefault();
        zoomOut();
        return;
      }

      // Cmd+0 → reset zoom
      if (e.key === "0") {
        e.preventDefault();
        zoomReset();
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeydown, { capture: true });
    // GestureEvent는 표준이 아니라 addEventListener의 타입 맵에 없다.
    for (const [type, handler] of GESTURE_HANDLERS) {
      window.addEventListener(type, handler as EventListener, {
        passive: false,
      });
    }
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeydown, { capture: true });
      for (const [type, handler] of GESTURE_HANDLERS) {
        window.removeEventListener(type, handler as EventListener);
      }
      // 핸들러가 떨어진 뒤에도 플래그가 남으면 ctrl+wheel 경로가 영영 막힌다.
      // ‼️ setGestureActive로 끈다 — 구독자에게 알리지 않고 플래그만 내리면
      // 정착을 기다리던 소비자가 영원히 깨어나지 않는다.
      setGestureActive(false);
    };
  }, [editor]);
}

/**
 * 측정 근거 (2026-08-15, WKWebView, 사용자 트랙패드):
 *
 *   gesturestart scale=1.0010  ms=0     ←→  ctrl-wheel deltaY=-0.099  ms=0
 *   gesturestart scale=1.0020  ms=1796  ←→  ctrl-wheel deltaY=-0.200  ms=1796
 *   gesturestart scale=0.9990  ms=3579  ←→  ctrl-wheel deltaY=+0.099  ms=3579
 *   gesturestart scale=2.1909  ms=412   ←→  (대응하는 wheel 없음)
 *   gesturestart scale=3.8938  ms=7806  ←→  (대응하는 wheel 없음)
 *
 * 즉 WKWebView는 배율이 0.1~0.2%씩 움직일 때만 ctrl+wheel을 합성해 보내고,
 * 실제 핀치의 크기(scale 2.19, 3.89, 0.285)는 **GestureEvent로만** 온다.
 * ctrl+wheel만 듣던 동안에는 그 부스러기만 받아서, 12초에 12개 남짓한
 * 0.1% 변화가 전부였다 — 사용자에게는 "핀치가 안 먹는" 것으로 보였다.
 *
 * scale이 누적값이라 `시작 시점의 줌 × scale`이 그대로 목표 배율이 된다.
 * 곱셈이므로 어느 배율에서든 같은 손동작이 같은 비율 변화를 낸다 — deltaY를
 * 더하던 방식은 줌 0.5에서와 2.0에서 반응이 4배 달랐다.
 */
let gestureActive = false;
let gestureBaseZoom = 1;

// §281.3 "핀치가 진행 중인가"를 밖에서 볼 수 있게 한다.
//
// 왜 필요한가 — 측정 (핀치·해제 3~4회, 4.7초):
//   제스처 중 : 프레임 32,  최악 116ms
//   제스처 밖 : 프레임 194, 최악 157ms
//
// 두 버킷 모두에서 큰 정지가 났고, 원인은 하나다. PDF의 정착 로직은 "마지막
// 배율 변화로부터 140ms"에 걸리는데, 핀치 도중 손이 잠깐 멎기만 해도 조건이
// 성립한다. 그 순간 보이는 페이지마다 캔버스 재래스터가 한 프레임에 몰린다
// (pdfjs의 캔버스 페인팅은 메인 스레드다).
//
// 제스처가 진행 중일 때의 재래스터는 **논리적으로 불필요하다** — 사용자가 아직
// 배율을 정하는 중이라 어차피 곧 다시 그려야 한다. 그래서 소비자가 제스처가
// 끝날 때까지 기다릴 수 있도록 상태를 알린다.
const gestureListeners = new Set<(active: boolean) => void>();

/** 지금 핀치 제스처가 진행 중인가. */
export function isZoomGestureActive(): boolean {
  return gestureActive;
}

/** 제스처 시작/종료 알림을 구독한다. 반환값을 호출하면 해제된다. */
export function subscribeZoomGesture(
  fn: (active: boolean) => void,
): () => void {
  gestureListeners.add(fn);
  return () => gestureListeners.delete(fn);
}

function handleGestureChange(e: SafariGestureEvent): void {
  if (!gestureActive) return;
  e.preventDefault();
  setZoom(gestureBaseZoom * e.scale);
}

function handleGestureEnd(e: SafariGestureEvent): void {
  e.preventDefault();
  setGestureActive(false);
}

function handleGestureStart(e: SafariGestureEvent): void {
  // ‼️ preventDefault가 없으면 WKWebView가 자기 페이지 줌을 수행하면서
  // 제스처를 다시 시작한다 — 진단 로그에서 gesturestart가 반복되고
  // gestureend가 한 번뿐이었던 이유다. 여기서 막아야 start → change* → end
  // 스트림이 온전해진다.
  e.preventDefault();
  setGestureActive(true);
  gestureBaseZoom = useSettingsStore.getState().zoomLevel;
}

function setGestureActive(active: boolean): void {
  if (gestureActive === active) return;
  gestureActive = active;
  for (const fn of gestureListeners) fn(active);
}

/** 등록/해제를 한 곳에서 — 짝이 어긋나면 플래그가 영영 켜진 채 남는다. */
const GESTURE_HANDLERS: [string, (e: SafariGestureEvent) => void][] = [
  ["gesturestart", handleGestureStart],
  ["gesturechange", handleGestureChange],
  ["gestureend", handleGestureEnd],
];

/** Continuous zoom from a wheel/pinch delta (`WheelEvent.deltaY`). */
export function zoomByWheel(deltaY: number): void {
  if (!Number.isFinite(deltaY)) return;
  setZoom(useSettingsStore.getState().zoomLevel - deltaY * PINCH_SENSITIVITY);
}

/** One keyboard step in. */
export function zoomIn(): void {
  setZoom(useSettingsStore.getState().zoomLevel + KEYBOARD_STEP);
}

/** One keyboard step out. */
export function zoomOut(): void {
  setZoom(useSettingsStore.getState().zoomLevel - KEYBOARD_STEP);
}

/** Back to 100%. */
export function zoomReset(): void {
  setZoom(1);
}

function applyZoom(level: number, editor: Editor | null): void {
  // Set CSS custom property on :root — all .editor-area-scroll elements
  // pick it up via `zoom: var(--editor-zoom, 1)` in layout.css.
  // This persists across mode switches (source/normal/journal) because
  // each mode has its own .editor-area-scroll element.
  document.documentElement.style.setProperty(
    "--editor-zoom",
    level === 1 ? "1" : String(level),
  );
  scheduleReflow(level, editor);
}

// Force ProseMirror plugins (BlockHandle, colwidth-init, etc.) to recalculate
// positions after zoom changes the layout.
//
// ‼️ 프레임당 한 번으로 합류시킨다. 미루는 것이 아니라 **중복을 접는** 것이다 —
// 예전에는 줌 변경마다 rAF를 새로 걸어서, 한 프레임 안에 도착한 휠 이벤트 N개가
// 트랜잭션 N개와 전역 resize 이벤트 N개를 만들었다. 그 프레임이 그리는 결과는
// 마지막 하나와 같으므로 앞의 N-1개는 전부 버려지는 작업이었다. 트랜잭션 비용은
// 마운트된 NodeView 수에 비례해서(PR #140) 큰 문서일수록 이 낭비가 커진다.
//
// 1% 양자화가 있던 동안에는 이 폭주가 우연히 가려져 있었다 — 대부분의 휠
// 이벤트가 레벨을 바꾸지 못해 여기까지 오지 않았다. 그 양자화를 걷어낸
// 지금(utils/zoom.ts) 합류는 선택이 아니라 필수다.
let reflowHandle: null | number = null;
let reflowLevel = 1;
let reflowEditor: Editor | null = null;

/** 언마운트 정리 — 예약된 reflow가 destroy된 에디터를 건드리지 않게 한다. */
function cancelReflow(): void {
  if (reflowHandle === null) return;
  cancelAnimationFrame(reflowHandle);
  reflowHandle = null;
  reflowEditor = null;
}

function scheduleReflow(level: number, editor: Editor | null): void {
  // 항상 **가장 최근** 값을 쓴다. 이미 예약돼 있으면 그 예약이 이 값을 그린다.
  reflowLevel = level;
  reflowEditor = editor;
  if (reflowHandle !== null) return;
  reflowHandle = requestAnimationFrame(() => {
    reflowHandle = null;
    if (reflowEditor && !reflowEditor.isDestroyed) {
      reflowEditor.view.dispatch(
        reflowEditor.state.tr.setMeta("zoom", reflowLevel),
      );
    }
    window.dispatchEvent(new Event("resize"));
  });
}

function setZoom(level: number): void {
  const { setZoomLevel, zoomLevel } = useSettingsStore.getState();
  // ‼️ 스토어와 **같은** 정규화를 쓴다(utils/zoom.ts). 여기서 따로 반올림하면
  // 이 비교가 스토어가 실제로 저장할 값이 아닌 값을 보게 되어, 스토어에서는
  // 달라지는 변경이 여기서 "같다"고 버려진다.
  const next = clampZoomLevel(level);
  if (next !== zoomLevel) setZoomLevel(next);
}

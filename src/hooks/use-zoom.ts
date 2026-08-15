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

  // Trackpad pinch (wheel + ctrlKey) + keyboard shortcuts
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
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
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeydown, { capture: true });
    };
  }, [editor]);
}

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

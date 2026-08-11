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

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
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
  // Force ProseMirror plugins (BlockHandle, colwidth-init, etc.) to
  // recalculate positions after zoom changes the layout.
  requestAnimationFrame(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dispatch(editor.state.tr.setMeta("zoom", level));
    }
    window.dispatchEvent(new Event("resize"));
  });
}

function clampZoom(level: number): number {
  return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level)) * 100) / 100;
}

function setZoom(level: number): void {
  const { setZoomLevel, zoomLevel } = useSettingsStore.getState();
  const next = clampZoom(level);
  if (next !== zoomLevel) setZoomLevel(next);
}

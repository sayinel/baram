// §4.2 Editor content zoom — trackpad pinch + Cmd+/Cmd-/Cmd+0
//
// Applies CSS zoom to .editor-area-scroll — this zooms both the editor content
// AND overlay components (BlockHandle, TableInsertButtons, FloatingToolbar, etc.)
// together, keeping their coordinates aligned at any zoom level.
// CSS zoom on this container creates a containing block for position:fixed
// descendants, so overlay positions are relative to the scroll area (correct).
// Persists zoom level in settings store.

import { useEffect } from "react";

import type { Editor } from "@tiptap/react";

import { useSettingsStore } from "../stores/settings/store";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const KEYBOARD_STEP = 0.1;
const PINCH_SENSITIVITY = 0.005;

export function useZoom(editor: Editor | null): void {
  // Apply persisted zoom level on mount
  useEffect(() => {
    const level = useSettingsStore.getState().zoomLevel;
    if (level !== 1) applyZoom(level, editor);

    // The scroll container may not exist yet on first mount; observe for it
    const observer = new MutationObserver(() => {
      const el = document.querySelector(".editor-area-scroll");
      if (el) {
        const lvl = useSettingsStore.getState().zoomLevel;
        if (lvl !== 1) applyZoom(lvl, editor);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [editor]);

  // Trackpad pinch (wheel + ctrlKey) + keyboard shortcuts
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();

      const { zoomLevel, setZoomLevel } = useSettingsStore.getState();
      const delta = -e.deltaY * PINCH_SENSITIVITY;
      const newLevel = clampZoom(zoomLevel + delta);
      if (newLevel !== zoomLevel) {
        setZoomLevel(newLevel);
        applyZoom(newLevel, editor);
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      // Cmd+= / Cmd++ → zoom in
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const { zoomLevel, setZoomLevel } = useSettingsStore.getState();
        const newLevel = clampZoom(zoomLevel + KEYBOARD_STEP);
        setZoomLevel(newLevel);
        applyZoom(newLevel, editor);
        return;
      }

      // Cmd+- → zoom out
      if (e.key === "-") {
        e.preventDefault();
        const { zoomLevel, setZoomLevel } = useSettingsStore.getState();
        const newLevel = clampZoom(zoomLevel - KEYBOARD_STEP);
        setZoomLevel(newLevel);
        applyZoom(newLevel, editor);
        return;
      }

      // Cmd+0 → reset zoom
      if (e.key === "0") {
        e.preventDefault();
        useSettingsStore.getState().setZoomLevel(1);
        applyZoom(1, editor);
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

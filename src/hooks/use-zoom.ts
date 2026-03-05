// §4.2 Editor content zoom — trackpad pinch + Cmd+/Cmd-/Cmd+0
//
// Applies CSS zoom to .tiptap editor element only (not the whole app UI).
// Persists zoom level in settings store.

import { useEffect } from "react";
import { useSettingsStore } from "../stores/settings-store";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.0;
const KEYBOARD_STEP = 0.1;
const PINCH_SENSITIVITY = 0.005;

function clampZoom(level: number): number {
  return Math.round(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, level)) * 100) / 100;
}

function applyZoom(level: number): void {
  const el = document.querySelector(".tiptap") as HTMLElement | null;
  if (el) {
    el.style.zoom = level === 1 ? "" : String(level);
  }
}

export function useZoom(): void {
  // Apply persisted zoom level on mount and when editor re-renders
  useEffect(() => {
    const level = useSettingsStore.getState().zoomLevel;
    if (level !== 1) applyZoom(level);

    // The .tiptap element may not exist yet on first mount; observe for it
    const observer = new MutationObserver(() => {
      const el = document.querySelector(".tiptap");
      if (el) {
        const lvl = useSettingsStore.getState().zoomLevel;
        if (lvl !== 1) applyZoom(lvl);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

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
        applyZoom(newLevel);
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
        applyZoom(newLevel);
        return;
      }

      // Cmd+- → zoom out
      if (e.key === "-") {
        e.preventDefault();
        const { zoomLevel, setZoomLevel } = useSettingsStore.getState();
        const newLevel = clampZoom(zoomLevel - KEYBOARD_STEP);
        setZoomLevel(newLevel);
        applyZoom(newLevel);
        return;
      }

      // Cmd+0 → reset zoom
      if (e.key === "0") {
        e.preventDefault();
        useSettingsStore.getState().setZoomLevel(1);
        applyZoom(1);
      }
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeydown, { capture: true });
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeydown, { capture: true });
    };
  }, []);
}

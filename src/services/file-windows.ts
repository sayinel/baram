// §89 A file window (`?mode=file`, torn off a tab) is its own webview with its own stores, and the
// process it shares with the main window ends for both on a quit or an update install. So the two
// have to talk: the file window reports whether it holds unsaved work, and the main window, which
// asks the question for both, asks it to save when the answer is Save.
//
// Closing a file window is not part of this. It asks for itself (`use-file-window-guard.ts`).
//
// The events are named here so a file window and the main window cannot disagree on them.
import { emit, emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

import { useFileWindowStore } from "../stores/system/file-windows";
import { logger } from "../utils/logger";

/** File window → main: `{ label, unsaved }`. */
const UNSAVED_REPORT = "file-window://unsaved";
/**
 * Rust → main: this file window is gone (`on_window_event` in `src-tauri/src/lib.rs`). From there
 * because a window cannot always say so: one that fell to the `ErrorBoundary` screen has lost its
 * listeners, so it closes without running any of its code.
 */
const WINDOW_CLOSED = "file-window://closed";
/** Main → every file window: report again. A reloaded main window has lost what it knew. */
const REPORT_REQUEST = "file-window://report";
/** Main → one file window: save. */
export const SAVE_REQUEST = "file-window://save";
/** File window → main: `{ label, ok }`. */
const SAVE_RESULT = "file-window://saved";

/** A window that does not answer within this counts as not saved, and the exit it waits on stops. */
export const SAVE_TIMEOUT_MS = 10_000;

interface SaveResult {
  label: string;
  ok: boolean;
}

interface UnsavedReport {
  label: string;
  unsaved: boolean;
}

/** Main window: keep `useFileWindowStore` current. Returns the call that stops listening. */
export async function followFileWindows(): Promise<UnlistenFn> {
  const { setUnsaved } = useFileWindowStore.getState();
  const unlisteners = await Promise.all([
    listen<UnsavedReport>(UNSAVED_REPORT, (event) => {
      setUnsaved(event.payload.label, event.payload.unsaved);
    }),
    listen<string>(WINDOW_CLOSED, (event) => {
      setUnsaved(event.payload, false);
    }),
  ]);
  await emit(REPORT_REQUEST);
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}

/** File window: run `report` whenever a reloaded main window asks again. */
export function onReportRequest(report: () => void): Promise<UnlistenFn> {
  return listen(REPORT_REQUEST, report);
}

/** File window: tell the main window the outcome of a `SAVE_REQUEST`. */
export function reportSaveResult(ok: boolean): Promise<void> {
  const result: SaveResult = { label: getCurrentWebviewWindow().label, ok };
  return emitTo("main", SAVE_RESULT, result);
}

/** File window: tell the main window whether this window holds unsaved work. */
export function reportUnsaved(unsaved: boolean): Promise<void> {
  const report: UnsavedReport = {
    label: getCurrentWebviewWindow().label,
    unsaved,
  };
  return emitTo("main", UNSAVED_REPORT, report);
}

/**
 * Main window: have every file window holding unsaved work save it.
 * @returns `true` once they all have; `false` if one failed or did not answer, and the caller must
 *   not go on to end the process.
 */
export async function saveFileWindows(): Promise<boolean> {
  const labels = [...useFileWindowStore.getState().unsaved];
  const results = await Promise.all(labels.map(saveFileWindow));
  return results.every(Boolean);
}

function saveFileWindow(label: string): Promise<boolean> {
  return new Promise((resolve) => {
    let unlisten: undefined | UnlistenFn;
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      unlisten?.();
      resolve(ok);
    };
    const timer = setTimeout(() => {
      logger.warn("[file-window] no answer to a save request:", label);
      finish(false);
    }, SAVE_TIMEOUT_MS);
    listen<SaveResult>(SAVE_RESULT, (event) => {
      if (event.payload.label === label) finish(event.payload.ok);
    })
      .then((fn) => {
        unlisten = fn;
        return emitTo(label, SAVE_REQUEST);
      })
      .catch((err: unknown) => {
        logger.warn("[file-window] save request failed:", err);
        finish(false);
      });
  });
}

// §44 The ways out of the main window that take the webview with it: quit, reload, and
// relaunch after an update. Each saves the chat history first — it is written at most once
// per interval (`stores/ai/chat.ts`, #800), so the last moments of a conversation may not
// be on disk yet.
//
// The exits are `confirmQuit()`, `window.location.reload()` and the updater's `relaunch()`,
// found with
// `grep -rnE "relaunch\(|confirmQuit\(|location\.reload\(|window\.close\(|process\.exit" src --exclude-dir=__tests__`
// (the `window.close()` hits close plugin sandbox windows, not this one). Call these helpers
// instead of the raw calls.
//
// ‼️ The wait is bounded. A save that never settles — a stuck IPC — must not make the app
// impossible to quit: after EXIT_SAVE_TIMEOUT_MS the exit goes ahead and the failure is
// logged. A later exit attempt while that save is still unsettled does not wait again.
import { relaunch } from "@tauri-apps/plugin-process";

import { confirmQuit } from "../ipc/invoke";
import { flushChatPersist } from "../stores/ai/chat";
import { logger } from "../utils/logger";

export const EXIT_SAVE_TIMEOUT_MS = 3_000;

/** The current exit's bounded wait, shared by exits that start while it runs. */
let waiting: null | Promise<void> = null;
/** A save an earlier exit gave up on that has still not settled. */
let abandoned: null | Promise<void> = null;

export async function quitApp(): Promise<void> {
  await saveBeforeExit();
  await confirmQuit();
}

export async function relaunchApp(): Promise<void> {
  await saveBeforeExit();
  await relaunch();
}

export async function reloadWindow(): Promise<void> {
  await saveBeforeExit();
  window.location.reload();
}

/** Save what must survive the exit; resolves within EXIT_SAVE_TIMEOUT_MS whatever happens. */
export function saveBeforeExit(): Promise<void> {
  if (waiting) return waiting;
  if (abandoned) {
    logger.warn(
      "[app-exit] an earlier save never finished; leaving without waiting",
    );
    return Promise.resolve();
  }
  const save = flushChatPersist().catch((e: unknown) => {
    logger.error("[app-exit] saving the chat history failed:", e);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), EXIT_SAVE_TIMEOUT_MS);
  });
  const current: Promise<void> = Promise.race([save, timeout]).then((r) => {
    clearTimeout(timer);
    waiting = null;
    if (r === "timeout") {
      logger.error(
        "[app-exit] saving the chat history timed out; leaving anyway",
      );
      abandoned = save;
      void save.then(() => {
        if (abandoned === save) abandoned = null;
      });
    }
  });
  waiting = current;
  return current;
}

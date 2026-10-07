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
// logged. Retrying that same exit does not wait again; see `abandoned` for what makes
// a later exit a new one.
import { relaunch } from "@tauri-apps/plugin-process";

import { confirmQuit } from "../ipc/invoke";
import { flushChatPersist, useChatStore } from "../stores/ai/chat";
import { logger } from "../utils/logger";

export const EXIT_SAVE_TIMEOUT_MS = 3_000;

/** The current exit's bounded wait, shared by exits that start while it runs. */
let waiting: null | Promise<void> = null;

/**
 * An exit whose save timed out, remembered so that RETRYING THAT EXIT does not wait again
 * behind the same stuck save. It is only a retry while nothing has changed: the terminal
 * action failing (the app did not leave) or the chat history changing (there is new
 * state to save) makes the next exit a fresh one, with a fresh bounded save.
 */
let abandoned: null | { chat: unknown; save: Promise<void> } = null;

export async function quitApp(): Promise<void> {
  await saveBeforeExit();
  await leave(confirmQuit);
}

export async function relaunchApp(): Promise<void> {
  await saveBeforeExit();
  await leave(relaunch);
}

export async function reloadWindow(): Promise<void> {
  await saveBeforeExit();
  await leave(() => window.location.reload());
}

/** Run an exit's terminal action; if it fails the app is still here, so forget the retry. */
async function leave(action: () => Promise<void> | void): Promise<void> {
  try {
    await action();
  } catch (e) {
    abandoned = null;
    throw e;
  }
}

/** Save what must survive the exit; resolves within EXIT_SAVE_TIMEOUT_MS whatever happens. */
export function saveBeforeExit(): Promise<void> {
  if (waiting) return waiting;
  if (abandoned && abandoned.chat === useChatStore.getState()) {
    logger.warn(
      "[app-exit] retrying an exit whose save never finished; leaving without waiting",
    );
    return Promise.resolve();
  }
  abandoned = null;
  const chat = useChatStore.getState();
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
      const entry = { chat, save };
      abandoned = entry;
      void save.then(() => {
        if (abandoned === entry) abandoned = null;
      });
    }
  });
  waiting = current;
  return current;
}

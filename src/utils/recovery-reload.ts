// §44 The Reload buttons of the error screens (#800).
//
// They should save the chat history first, as every exit does (`services/app-exit.ts`). But
// these buttons are the way out of a broken app, so they must not depend on the parts that
// may be what broke: the save helper is loaded only when the button is pressed, and if
// loading or running it fails for any reason the window reloads anyway.
import { logger } from "./logger";

export async function reloadFromErrorScreen(): Promise<void> {
  try {
    const { reloadWindow } = await import("../services/app-exit");
    await reloadWindow();
  } catch (e) {
    logger.error("[recovery-reload] saving before the reload failed:", e);
    window.location.reload();
  }
}

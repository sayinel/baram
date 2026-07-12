// App lifecycle IPC commands
import { invoke } from "@tauri-apps/api/core";

/**
 * Confirm an app quit after the user resolves the unsaved-changes prompt.
 * Flips the Rust-side QuitGuard so the close/quit interceptor lets the exit
 * through, then exits the app.
 */
export async function confirmQuit(): Promise<void> {
  return invoke<void>("confirm_quit");
}

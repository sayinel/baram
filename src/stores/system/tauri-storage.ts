// §3.2 Tauri-backed storage adapter for Zustand persist middleware.
// Stores config in app_data_dir/config.json via Rust IPC instead of localStorage.

import type { StateStorage } from "zustand/middleware";

import { getConfig, removeConfig, setConfig } from "../../ipc/invoke";
import { logger } from "../../utils/logger";

// §89 File-mode windows must not persist state — they would overwrite the
// main window's session with their near-empty store state.
const _fileModeParams = new URLSearchParams(window.location.search);
const isFileMode = _fileModeParams.get("mode") === "file";

/**
 * Custom StateStorage that delegates to Tauri's config module.
 * Zustand persist calls getItem/setItem/removeItem with serialized JSON strings.
 * In file-mode windows, setItem/removeItem are no-ops to prevent session corruption.
 */
export const tauriStorage: StateStorage = {
  getItem: async (name: string): Promise<null | string> => {
    try {
      return await getConfig(name);
    } catch (e) {
      logger.warn("[tauriStorage] getItem failed, returning null:", e);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (isFileMode) return; // §89 Prevent file-mode window from overwriting session
    try {
      await setConfig(name, value);
    } catch (e) {
      logger.error("[tauriStorage] setItem failed:", e);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (isFileMode) return; // §89 Prevent file-mode window from overwriting session
    try {
      await removeConfig(name);
    } catch (e) {
      logger.error("[tauriStorage] removeItem failed:", e);
    }
  },
};

/** localStorage keys used by Zustand persist stores */
const MIGRATION_KEYS = ["baram:settings", "baram:ai-settings"];

/**
 * One-time migration: copy existing localStorage data to Tauri storage,
 * then remove from localStorage. Skips keys that already exist in Tauri storage.
 */
export async function migrateFromLocalStorage(): Promise<void> {
  for (const key of MIGRATION_KEYS) {
    try {
      const existing = await getConfig(key);
      if (existing) continue; // already migrated

      const localValue = localStorage.getItem(key);
      if (!localValue) continue; // nothing to migrate

      await setConfig(key, localValue);
      localStorage.removeItem(key);
      logger.debug(`[tauriStorage] Migrated "${key}" from localStorage`);
    } catch (e) {
      logger.warn(`[tauriStorage] Migration failed for "${key}":`, e);
    }
  }
}

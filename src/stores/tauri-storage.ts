// §3.2 Tauri-backed storage adapter for Zustand persist middleware.
// Stores config in app_data_dir/config.json via Rust IPC instead of localStorage.

import type { StateStorage } from "zustand/middleware";

import { getConfig, removeConfig, setConfig } from "../ipc/invoke";

/**
 * Custom StateStorage that delegates to Tauri's config module.
 * Zustand persist calls getItem/setItem/removeItem with serialized JSON strings.
 */
export const tauriStorage: StateStorage = {
  getItem: async (name: string): Promise<null | string> => {
    try {
      return await getConfig(name);
    } catch (e) {
      console.warn("[tauriStorage] getItem failed, returning null:", e);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await setConfig(name, value);
    } catch (e) {
      console.error("[tauriStorage] setItem failed:", e);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await removeConfig(name);
    } catch (e) {
      console.error("[tauriStorage] removeItem failed:", e);
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
      console.log(`[tauriStorage] Migrated "${key}" from localStorage`);
    } catch (e) {
      console.warn(`[tauriStorage] Migration failed for "${key}":`, e);
    }
  }
}

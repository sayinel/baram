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

/**
 * Fixed keys previously written to localStorage by Zustand persist stores.
 *
 * Bookmarks are deliberately NOT here — see `MIGRATION_PREFIXES`.
 */
const MIGRATION_KEYS = [
  "baram:settings",
  "baram:ai-settings",
  // §260 Phase 5 — moved off the default (localStorage) persist backend.
  "baram:journal-layout",
];

/**
 * §260 Phase 5 — key families that cannot be enumerated in advance.
 *
 * `baram:bookmarks:{vaultRoot}` is one key per vault the user has ever opened, so a
 * static list would silently strand every vault but the ones someone thought to name.
 */
const MIGRATION_PREFIXES = ["baram:bookmarks:"];

/**
 * One-time migration: copy existing localStorage data to Tauri storage,
 * then remove from localStorage. Skips keys that already exist in Tauri storage.
 */
export async function migrateFromLocalStorage(): Promise<void> {
  for (const key of keysToMigrate()) {
    try {
      const existing = await getConfig(key);
      // ‼️ A truthy config value is not proof of a completed migration (§260 Phase 5
      // re-review, R6). An EMPTY collection is what a store writes when it loaded nothing
      // — which is exactly what happens if anything reads before this sweep runs — so
      // treating `"[]"` as "already migrated" would skip, and (with the removal below)
      // delete the only surviving copy of the user's data. `main.tsx` awaiting this before
      // the app graph loads is what prevents that write; this is the second lock, because
      // the consequence of the first one slipping is permanent rather than recoverable.
      if (existing && !isEmptyCollection(existing)) {
        // Genuinely migrated — delete the copy anyway (§260 Phase 5 code review, H1).
        // Leaving it kept the exact shared-origin surface this sweep exists to remove:
        // every `plugin-*` webview shares this origin, so a zero-capability plugin could
        // still read it.
        localStorage.removeItem(key);
        continue;
      }

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

/**
 * Is this stored value an empty collection — i.e. indistinguishable from "the store had
 * nothing to save"? Used to decide that a config value is NOT evidence of a migration.
 *
 * Deliberately narrow: only the degenerate serialisations. A populated value, or anything
 * unparseable, counts as real and is left alone.
 */
function isEmptyCollection(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "[]" || trimmed === "{}" || trimmed === "null") return true;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (parsed !== null && typeof parsed === "object") {
      return Object.keys(parsed).length === 0;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * The fixed keys plus every prefixed key actually present, snapshotted BEFORE the loop
 * starts removing entries — iterating `localStorage` by index while deleting from it
 * skips every other match.
 */
function keysToMigrate(): string[] {
  const found = [...MIGRATION_KEYS];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && MIGRATION_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      found.push(key);
    }
  }
  return found;
}

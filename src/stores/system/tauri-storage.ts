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
      // review, R6). An empty value is what a store writes when it loaded nothing — which
      // is exactly what happens if anything reads before this sweep runs — so treating it
      // as "already migrated" would skip, and (with the removal below) delete the only
      // surviving copy of the user's data. `main.tsx` awaiting this before the app graph
      // loads is what prevents that write; this is the second lock, because the consequence
      // of the first one slipping is permanent rather than recoverable.
      //
      // That second lock is PARTIAL — `isEmptyCollection` records which keys it covers.
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
 * Empty array, empty object, `null`, or an object every one of whose values is itself
 * degenerate — which is what `{state: {collapsed: {}}, version: 0}` reduces to.
 *
 * Depth-bounded rather than freely recursive: this reads a value off disk and runs before
 * the app has rendered anything. ‼️ Past the bound it returns `false` — "not degenerate" —
 * which is the direction that DELETES the localStorage copy, so the margin matters: real
 * depth for the covered keys is 3 (envelope → state → collapsed → values).
 */
function isDegenerate(value: unknown, depth = 0): boolean {
  if (value === null) return true;
  if (depth > 4 || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length === 0;

  // The persist envelope is a TOP-LEVEL concept, so the unwrap is gated on depth
  // (§260 Phase 5 round 4, G2). Applied at any depth, a store whose own state happened to
  // contain a key named `state` would have its siblings ignored:
  // `{"state":{"state":{},"realData":{…}}}` would read as degenerate and the real config
  // value would be overwritten. Not reachable with today's four keys, but the contract
  // should match the comment rather than rely on that.
  //
  // `version` is persist bookkeeping, never user data, so it must not make an otherwise
  // empty envelope look populated — which is why the envelope branch looks at `state` alone.
  const meaningful =
    depth === 0 && "state" in value
      ? [(value as { state: unknown }).state]
      : Object.values(value as Record<string, unknown>);
  return meaningful.every((v) => isDegenerate(v, depth + 1));
}

/**
 * Is this stored value indistinguishable from "the store had nothing to save"? Used to
 * decide that a config value is NOT evidence of a completed migration.
 *
 * Unwraps zustand's persist envelope (`{state, version}`) before judging, because that is
 * the shape three of the four migrated key families actually have (§260 Phase 5 re-review,
 * F3 — the first version recognised only a bare `"[]"`, which is `bookmark.ts` alone, while
 * the comment claimed the rule generally).
 *
 * ‼️ HONEST BOUND: this can only ever catch a store whose INITIAL STATE IS EMPTY.
 * `journal-layout` qualifies (`{collapsed:{}}`) and so does `bookmark`. `baram:settings`
 * and `baram:ai-settings` do NOT — their initial state is a populated set of defaults,
 * indistinguishable from choices the user made. For those keys the ordering in `main.tsx`
 * is the only protection, and it has to be: no inspection of the value can tell a default
 * apart from a deliberate setting.
 *
 * Anything unparseable counts as real and is left alone — guessing otherwise would
 * overwrite data we simply could not read.
 */
function isEmptyCollection(raw: string): boolean {
  try {
    return isDegenerate(JSON.parse(raw.trim()));
  } catch {
    return false;
  }
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

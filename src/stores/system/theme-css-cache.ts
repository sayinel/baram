// §361 — an installed (community) theme's stored CSS text, cached in memory only.
//
// `theme-install.ts`'s `InstalledTheme` deliberately carries a `css: boolean` flag per mode
// and not the CSS text itself (see that type's doc comment — keeping the settings store's
// persisted blob small, since it is rewritten on every settings change). The text lives on
// disk (Rust's install tree) and is re-read on demand via `theme-store-fs.ts`'s
// `readStoredThemeCss`; this store is where that re-read result waits until the next read.
//
// Deliberately NOT persisted. It is a pure cache of a disk read — nothing here is a source
// of truth for anything, so there is nothing to survive a restart for. `no-local-storage`'s
// concern (sandboxed plugins share this webview's origin) does not apply to `create()`
// without `persist`: nothing here ever reaches `localStorage`.
import { create } from "zustand";

interface ThemeCssCacheState {
  /**
   * §361 Task 6 — forget every mode cached for one theme, so the next hydration reads the
   * disk again.
   *
   * ‼️ WITHOUT THIS AN UPDATE IS INVISIBLE. `use-theme-css-hydration.ts` skips its read when
   * `entries[key] !== undefined`, so after `installTheme` has swapped a new version onto
   * disk the cached text of the OLD one keeps being applied, for the rest of the session and
   * every session after it (this store is rebuilt on each launch, so the first read after a
   * restart does get the new bytes — which is what makes the stale window look like "the
   * update did nothing until I restarted" rather than a permanent failure).
   *
   * Uninstall needs it for the same reason and a worse outcome: the entry outlives the
   * record, so uninstalling and installing the same id again re-applies the CSS of the copy
   * that was deleted.
   */
  clearTheme: (themeId: string) => void;
  /** Keyed by `installed-theme-defs.ts`'s `themeCssCacheKey`. */
  entries: Record<string, string>;
  setCss: (key: string, css: string) => void;
}

export const useThemeCssCacheStore = create<ThemeCssCacheState>((set) => ({
  entries: {},
  clearTheme: (themeId) =>
    set((state) => {
      // The key is `${themeId}:${mode}` (`themeCssCacheKey`), so the prefix — WITH the
      // separator — is what distinguishes this theme's modes from those of a theme whose id
      // merely starts with the same characters. `dracula` must not drop `dracula-pro:dark`.
      const prefix = `${themeId}:`;
      const kept = Object.entries(state.entries).filter(
        ([key]) => !key.startsWith(prefix),
      );
      // Equality gate, same reasoning as `setCss` below: clearing a theme that has nothing
      // cached is the common case (every theme with no CSS, and every uninstall of one that
      // was never applied this session).
      if (kept.length === Object.keys(state.entries).length) return state;
      return { entries: Object.fromEntries(kept) };
    }),
  setCss: (key, css) =>
    set((state) =>
      // Equality gate: a store write on every hydration attempt (even a redundant one
      // triggered by an unrelated `installedThemes` change) would otherwise create a new
      // `entries` object each time and wake every subscriber for nothing.
      state.entries[key] === css
        ? state
        : { entries: { ...state.entries, [key]: css } },
    ),
}));

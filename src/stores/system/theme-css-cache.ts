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
  /** Keyed by `installed-theme-defs.ts`'s `themeCssCacheKey`. */
  entries: Record<string, string>;
  setCss: (key: string, css: string) => void;
}

export const useThemeCssCacheStore = create<ThemeCssCacheState>((set) => ({
  entries: {},
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

import type { InstalledTheme } from "../../themes/theme-install";
import type { ThemeDef } from "../../types/theme";
import type { ActivityBarItemConfig } from "./activity-bar-config";
import type { StateCreator } from "zustand";

import { setConfig } from "../../ipc/config";
import { lookupThemes } from "../../themes/installed-theme-defs";
import { findThemeById, themeFieldFor } from "../../types/theme";
import { logger } from "../../utils/logger";

export interface AppearanceSettingsSlice {
  activeThemeId: string;
  activityBarConfig: ActivityBarItemConfig[];
  /** §361 — record a freshly installed community theme. The record IS the enumeration
   *  (`theme-store-fs.ts`'s header explains why nothing re-reads the install tree). */
  addInstalledTheme: (theme: InstalledTheme) => void;
  customThemes: ThemeDef[];
  deleteCustomTheme: (id: string) => void;
  /** §361 — installed (community/registry) themes, keyed by id. Persisted via
   *  `tauriStorage`, never `localStorage` (sandbox webviews share this origin). */
  installedThemes: Record<string, InstalledTheme>;
  locale: string;
  /** §361 — drop the record for an uninstalled community theme. Does not touch disk —
   *  callers uninstall first (`ipc/theme.ts`'s `themeUninstall`) and only remove the record
   *  once that succeeds, the same order `handleUninstall` uses for plugins. */
  removeInstalledTheme: (id: string) => void;
  removeTagColor: (tag: string) => void;
  resetActivityBarConfig: () => void;
  saveCustomTheme: (theme: ThemeDef) => void;
  setActiveTheme: (id: string) => void;
  setActivityBarConfig: (config: ActivityBarItemConfig[]) => void;
  setLocale: (locale: string) => void;
  setTagColor: (tag: string, color: string) => void;
  setTheme: (theme: Theme) => void;
  tagColors: Record<string, string>;
  theme: Theme;
}

type Theme = "dark" | "light" | "system";

export const createAppearanceSettingsSlice: StateCreator<
  AppearanceSettingsSlice,
  [],
  [],
  AppearanceSettingsSlice
> = (set, get) => ({
  // Appearance
  theme: "system",
  activeThemeId: "system",
  customThemes: [],
  installedThemes: {},

  // Activity Bar config
  activityBarConfig: [], // default set in main store via DEFAULT_ACTIVITY_BAR_CONFIG

  // i18n
  locale: "en",

  // Tag colors
  tagColors: {},

  // Appearance setters
  setTheme: (theme) => {
    const id =
      theme === "light"
        ? "default-light"
        : theme === "dark"
          ? "default-dark"
          : "system";
    get().setActiveTheme(id);
  },
  setActiveTheme: (id) =>
    set((state) => {
      if (id === "system") return { activeThemeId: id, theme: "system" };
      // §361 — installed themes need to be in this lookup too, or a paired community
      // theme's `theme` field would default to "system" (`themeFieldFor(undefined)`)
      // instead of following its actual mode count. CSS text is not needed here — only
      // which modes exist — so `lookupThemes` is called with no cache argument.
      const theme = findThemeById(
        id,
        lookupThemes(state.customThemes, state.installedThemes),
      );
      return { activeThemeId: id, theme: themeFieldFor(theme) };
    }),
  saveCustomTheme: (theme) =>
    set((state) => {
      const idx = state.customThemes.findIndex((t) => t.id === theme.id);
      const updated = [...state.customThemes];
      if (idx >= 0) updated[idx] = theme;
      else updated.push(theme);
      return { customThemes: updated };
    }),
  deleteCustomTheme: (id) =>
    set((state) => ({
      customThemes: state.customThemes.filter((t) => t.id !== id),
      activeThemeId:
        state.activeThemeId === id ? "system" : state.activeThemeId,
      theme: state.activeThemeId === id ? "system" : state.theme,
    })),
  addInstalledTheme: (theme) =>
    set((state) => ({
      installedThemes: { ...state.installedThemes, [theme.id]: theme },
    })),
  removeInstalledTheme: (id) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _removed, ...rest } = state.installedThemes;
      return {
        installedThemes: rest,
        // Same rule as deleteCustomTheme: removing the ACTIVE theme falls back to system
        // rather than leaving activeThemeId pointing at a record that no longer exists.
        activeThemeId:
          state.activeThemeId === id ? "system" : state.activeThemeId,
        theme: state.activeThemeId === id ? "system" : state.theme,
      };
    }),

  // Activity Bar setters
  setActivityBarConfig: (activityBarConfig) => set({ activityBarConfig }),
  resetActivityBarConfig: () => set({}), // overridden in main store

  // i18n setter
  setLocale: (locale) => {
    set({ locale });
    import("../../ipc/menu-locale").then(({ syncMenuLocale }) => {
      syncMenuLocale(locale as "en" | "ko").catch((e) => logger.error(e));
    });
    // §333 The Rust-side approval dialog has its own phrase table (Rust has no
    // i18n) — mirror the locale to a flat config key so it can pick a language
    // from that table. The webview changing this value only ever **selects**
    // from the table; it cannot inject wording into the dialog.
    void setConfig("uiLocale", locale).catch((e) =>
      logger.warn("§333 setLocale: uiLocale mirror failed", e),
    );
  },

  // Tag setters
  setTagColor: (tag, color) =>
    set((state) => ({
      tagColors: { ...state.tagColors, [tag]: color },
    })),
  removeTagColor: (tag) =>
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [tag]: _removed, ...rest } = state.tagColors;
      return { tagColors: rest };
    }),
});

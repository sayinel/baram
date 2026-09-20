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
  /**
   * §361 — record an installed community theme. The record IS the enumeration
   * (`theme-store-fs.ts`'s header explains why nothing re-reads the install tree).
   *
   * ‼️ An id already present is an UPDATE, and an update KEEPS the consent the first install
   * recorded — see the implementation for why that rule lives here.
   */
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
    set((state) => {
      const prior = state.installedThemes[theme.id];
      // §361 Task 6 — the consent carry-forward, HERE rather than in the update caller.
      //
      // `installTheme` stamps `consentedAt`/`consentedVersion` with "now" and the version it
      // just installed, which is right for a first install and wrong for an update: nothing
      // was agreed to at that moment, and `showConsentHistory` would then tell the user they
      // approved v2.0 today when what they approved was v1.0 whenever they installed it.
      // `InstalledTheme.consentedAt`'s doc comment states that contract.
      //
      // Enforced at the single writer instead of at each call site so a future third caller
      // cannot reintroduce the defect by forgetting. A record that is ABSENT is a genuine
      // first install (uninstall removes it), so the stamp from `installTheme` stands.
      //
      // Themes never re-ask: there is no capability tuple to escalate (spec §9.3), so there
      // is no case where an update should produce a NEW consent moment. The three fixed
      // sentences hold for every version the hygiene pipeline will accept, which is what
      // makes carrying the old stamp forward true rather than merely convenient.
      const merged: InstalledTheme =
        prior === undefined
          ? theme
          : {
              ...theme,
              consentedAt: prior.consentedAt,
              consentedVersion: prior.consentedVersion,
            };
      return {
        installedThemes: { ...state.installedThemes, [theme.id]: merged },
      };
    }),
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

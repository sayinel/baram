import type { ThemeDef } from "../../types/theme";
import type { ActivityBarItemConfig } from "../settings-store";
import type { StateCreator } from "zustand";

import { findThemeById } from "../../types/theme";
import { logger } from "../../utils/logger";

export interface AppearanceSettingsSlice {
  activeThemeId: string;
  activityBarConfig: ActivityBarItemConfig[];
  customThemes: ThemeDef[];
  deleteCustomTheme: (id: string) => void;
  locale: string;
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
      let base: "dark" | "light" | "system" = "system";
      if (id !== "system") {
        const theme = findThemeById(id, state.customThemes);
        base = theme?.base ?? "light";
      }
      return { activeThemeId: id, theme: base };
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

  // Activity Bar setters
  setActivityBarConfig: (activityBarConfig) => set({ activityBarConfig }),
  resetActivityBarConfig: () => set({}), // overridden in main store

  // i18n setter
  setLocale: (locale) => {
    set({ locale });
    import("../../ipc/menu-locale").then(({ syncMenuLocale }) => {
      syncMenuLocale(locale as "en" | "ko").catch((e) => logger.error(e));
    });
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

import type { StateCreator } from "zustand";

export interface ZettelkastenSettingsSlice {
  setZettelkastenDirectory: (dir: string) => void;
  setZettelkastenEnabled: (enabled: boolean) => void;
  setZettelkastenHomeNote: (path: string) => void;
  setZettelkastenStartupBehavior: (behavior: ZettelStartupBehavior) => void;
  zettelkastenDirectory: string;
  zettelkastenEnabled: boolean;
  zettelkastenHomeNote: string;
  zettelkastenStartupBehavior: ZettelStartupBehavior;
}
/** Startup behaviours in display order. The Zettel tab's `<select>` and the settings-search
 *  entry both map this list, so a behaviour added here shows up in both. */
export const ZETTEL_STARTUP_BEHAVIORS = ["openHomeNote", "nothing"] as const;
export type ZettelStartupBehavior = (typeof ZETTEL_STARTUP_BEHAVIORS)[number];

export const createZettelkastenSettingsSlice: StateCreator<
  ZettelkastenSettingsSlice,
  [],
  [],
  ZettelkastenSettingsSlice
> = (set) => ({
  // §92 Zettelkasten space
  zettelkastenEnabled: false,
  zettelkastenDirectory: "",
  zettelkastenStartupBehavior: "openHomeNote",
  zettelkastenHomeNote: "",

  // Setters
  setZettelkastenEnabled: (zettelkastenEnabled) => set({ zettelkastenEnabled }),
  setZettelkastenDirectory: (zettelkastenDirectory) =>
    set({ zettelkastenDirectory }),
  setZettelkastenStartupBehavior: (zettelkastenStartupBehavior) =>
    set({ zettelkastenStartupBehavior }),
  setZettelkastenHomeNote: (zettelkastenHomeNote) =>
    set({ zettelkastenHomeNote }),
});

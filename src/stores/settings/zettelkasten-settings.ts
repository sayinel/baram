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
type ZettelStartupBehavior = "nothing" | "openInbox";

export const createZettelkastenSettingsSlice: StateCreator<
  ZettelkastenSettingsSlice,
  [],
  [],
  ZettelkastenSettingsSlice
> = (set) => ({
  // §92 Zettelkasten space
  zettelkastenEnabled: false,
  zettelkastenDirectory: "",
  zettelkastenStartupBehavior: "openInbox",
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

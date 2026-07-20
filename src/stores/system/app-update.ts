// §206 App auto-update — state-only store. All check()/install() logic lives
// in services/app-update.ts; this store only tracks status for the UI.
import { create } from "zustand";

export interface AppUpdateProgress {
  downloaded: number;
  total: null | number;
}

export type AppUpdateStatus =
  | "available"
  | "checking"
  | "downloading"
  | "error"
  | "idle"
  | "installing"
  | "upToDate";

interface AppUpdateState {
  availableVersion: null | string;
  closeDialog: () => void;
  dialogOpen: boolean;
  error: null | string;
  /** True when an install failure fell back to opening the releases page. */
  fallbackOpened: boolean;
  lastCheckedAt: null | number;
  notes: null | string;
  openDialog: () => void;
  progress: AppUpdateProgress | null;
  setAvailable: (version: string, notes: null | string) => void;
  setChecking: () => void;
  setDownloading: () => void;
  setError: (message: string, fallbackOpened?: boolean) => void;
  setInstalling: () => void;
  setProgress: (progress: AppUpdateProgress) => void;
  setUpToDate: () => void;
  status: AppUpdateStatus;
}

export const useAppUpdateStore = create<AppUpdateState>()((set) => ({
  status: "idle",
  availableVersion: null,
  notes: null,
  progress: null,
  lastCheckedAt: null,
  error: null,
  dialogOpen: false,
  fallbackOpened: false,

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),

  setChecking: () =>
    set({ status: "checking", error: null, fallbackOpened: false }),

  setAvailable: (availableVersion, notes) =>
    set({
      status: "available",
      availableVersion,
      notes,
      lastCheckedAt: Date.now(),
    }),

  // §206-review: also clear a previously-detected version and close the
  // dialog — otherwise a later "no update" result (e.g. the release was
  // withdrawn, or the app was updated another way) can leave a stale
  // "Update to vX" dialog open with a no-op Install button.
  setUpToDate: () =>
    set({
      status: "upToDate",
      availableVersion: null,
      notes: null,
      dialogOpen: false,
      lastCheckedAt: Date.now(),
    }),

  setDownloading: () => set({ status: "downloading", progress: null }),

  setProgress: (progress) => set({ progress }),

  setInstalling: () => set({ status: "installing" }),

  setError: (message, fallbackOpened = false) =>
    set({ status: "error", error: message, fallbackOpened }),
}));

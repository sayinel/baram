// §11.7 AuthorshipStore — per-file authorship tracker management
import { create } from "zustand";

import { AuthorshipTracker } from "../utils/authorship-tracker";

// Trackers keyed by file path — kept outside Zustand to avoid serialization issues
const trackers = new Map<string, AuthorshipTracker>();

interface AuthorshipState {
  getOrCreateTracker: (filePath: string) => AuthorshipTracker;
  hasTracker: (filePath: string) => boolean;
  isEnabled: boolean;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
}

export const useAuthorshipStore = create<AuthorshipState>()((set) => ({
  getOrCreateTracker: (filePath: string): AuthorshipTracker => {
    let tracker = trackers.get(filePath);
    if (!tracker) {
      tracker = new AuthorshipTracker();
      trackers.set(filePath, tracker);
    }
    return tracker;
  },

  hasTracker: (filePath: string): boolean => {
    return trackers.has(filePath);
  },

  isEnabled: false,

  reset: () => {
    trackers.clear();
    set({ isEnabled: false });
  },

  setEnabled: (enabled: boolean) => {
    set({ isEnabled: enabled });
  },
}));

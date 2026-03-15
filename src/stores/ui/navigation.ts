// §37 Navigation History Store — browser-style back/forward
import { create } from "zustand";

const MAX_STACK_SIZE = 100;

interface NavigationState {
  /** Internal flag to suppress pushHistory during goBack/goForward */
  _navigating: boolean;
  backStack: string[];
  forwardStack: string[];

  /** Go back: pop from backStack, push current to forwardStack. Returns target tabId or null. */
  goBack: (currentTabId: string, openTabIds?: Set<string>) => null | string;
  /** Go forward: pop from forwardStack, push current to backStack. Returns target tabId or null. */
  goForward: (currentTabId: string, openTabIds?: Set<string>) => null | string;
  /** Check if currently navigating (back/forward in progress) */
  isNavigating: () => boolean;
  /** Push current tabId to backStack when navigating to a new tab. Clears forwardStack. */
  pushHistory: (tabId: string) => void;
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  backStack: [],
  forwardStack: [],
  _navigating: false,

  pushHistory: (tabId) =>
    set((state) => {
      const backStack = [...state.backStack, tabId];
      // Trim to max size
      if (backStack.length > MAX_STACK_SIZE) {
        backStack.splice(0, backStack.length - MAX_STACK_SIZE);
      }
      return { backStack, forwardStack: [] };
    }),

  goBack: (currentTabId, openTabIds) => {
    const state = get();
    const backStack = [...state.backStack];

    // Find the next valid (open) tab from the back of the stack
    let targetId: null | string = null;
    while (backStack.length > 0) {
      const candidate = backStack.pop()!;
      if (!openTabIds || openTabIds.has(candidate)) {
        targetId = candidate;
        break;
      }
    }

    if (targetId === null) {
      set({ backStack: [] });
      return null;
    }

    // Filter remaining closed tabs from stack
    const cleanedBack = openTabIds
      ? backStack.filter((id) => openTabIds.has(id))
      : backStack;

    set({
      backStack: cleanedBack,
      forwardStack: [...state.forwardStack, currentTabId],
      _navigating: true,
    });

    queueMicrotask(() => set({ _navigating: false }));
    return targetId;
  },

  goForward: (currentTabId, openTabIds) => {
    const state = get();
    const forwardStack = [...state.forwardStack];

    let targetId: null | string = null;
    while (forwardStack.length > 0) {
      const candidate = forwardStack.pop()!;
      if (!openTabIds || openTabIds.has(candidate)) {
        targetId = candidate;
        break;
      }
    }

    if (targetId === null) {
      set({ forwardStack: [] });
      return null;
    }

    // Filter remaining closed tabs from stack
    const cleanedForward = openTabIds
      ? forwardStack.filter((id) => openTabIds.has(id))
      : forwardStack;

    set({
      backStack: [...state.backStack, currentTabId],
      forwardStack: cleanedForward,
      _navigating: true,
    });

    queueMicrotask(() => set({ _navigating: false }));
    return targetId;
  },

  isNavigating: () => get()._navigating,
}));

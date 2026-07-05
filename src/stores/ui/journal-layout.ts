// §56 Journal sidebar layout — persisted collapse state for JournalSection panels
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface JournalLayoutState {
  /** Explicit collapse state per section id; absence means "use the default". */
  collapsed: Record<string, boolean>;
  setCollapsed: (id: string, value: boolean) => void;
  toggle: (id: string, fallback: boolean) => void;
}

export const useJournalLayoutStore = create<JournalLayoutState>()(
  persist(
    (set) => ({
      collapsed: {},
      setCollapsed: (id, value) =>
        set((s) => ({ collapsed: { ...s.collapsed, [id]: value } })),
      toggle: (id, fallback) =>
        set((s) => ({
          collapsed: { ...s.collapsed, [id]: !(s.collapsed[id] ?? fallback) },
        })),
    }),
    { name: "baram:journal-layout" },
  ),
);

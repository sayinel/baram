// §89 Which file windows hold unsaved work, as the main window knows it. Each file window is its
// own webview with its own stores, so it says so itself (`services/file-windows.ts`) and this is
// where the main window keeps the answer.
import { create } from "zustand";

interface FileWindowState {
  setUnsaved: (label: string, unsaved: boolean) => void;
  /** Labels of the file windows that last reported unsaved work. */
  unsaved: ReadonlySet<string>;
}

export const useFileWindowStore = create<FileWindowState>()((set, get) => ({
  unsaved: new Set(),
  setUnsaved: (label, unsaved) => {
    if (get().unsaved.has(label) === unsaved) return;
    const next = new Set(get().unsaved);
    if (unsaved) next.add(label);
    else next.delete(label);
    set({ unsaved: next });
  },
}));

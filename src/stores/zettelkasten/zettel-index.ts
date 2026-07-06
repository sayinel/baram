// §95 Zettel index store — id ↔ title ↔ path mapping for notes/ + inbox/
import { create } from "zustand";

import { listDir, readFile } from "../../ipc/invoke";
import { parseNoteTitle } from "../../utils/zettelkasten/parse-note-title";

export interface ZettelNote {
  id: string;
  path: string;
  title: string;
}

interface ZettelIndexState {
  byId: Record<string, ZettelNote>;
  clear: () => void;
  removeByPath: (path: string) => void;
  setAll: (notes: ZettelNote[]) => void;
  upsert: (note: ZettelNote) => void;
}

export const useZettelIndexStore = create<ZettelIndexState>((set) => ({
  byId: {},
  setAll: (notes) =>
    set({ byId: Object.fromEntries(notes.map((n) => [n.id, n])) }),
  upsert: (note) => set((s) => ({ byId: { ...s.byId, [note.id]: note } })),
  removeByPath: (path) =>
    set((s) => ({
      byId: Object.fromEntries(
        Object.entries(s.byId).filter(([, n]) => n.path !== path),
      ),
    })),
  clear: () => set({ byId: {} }),
}));

/** Resolves the id ONLY when exactly one note has that title (case-insensitive); null if 0 or ambiguous (>1). */
export function idForTitle(title: string): null | string {
  const q = title.trim().toLowerCase();
  const matches = Object.values(useZettelIndexStore.getState().byId).filter(
    (n) => n.title.toLowerCase() === q,
  );
  return matches.length === 1 ? matches[0].id : null;
}

/** Scans notes/ + inbox/ under zettelDir, builds the id→note index, and replaces the store's contents. */
export async function refreshZettelIndex(zettelDir: string): Promise<void> {
  const notes: ZettelNote[] = [];
  for (const sub of ["notes", "inbox"]) {
    let entries: { name: string; path: string }[];
    try {
      entries = await listDir(`${zettelDir}/${sub}`, false);
    } catch {
      continue;
    }
    for (const e of entries) {
      const m = e.name.match(/^(\d{12,14})\b/);
      if (!m || !/\.(md|markdown)$/.test(e.name)) continue;
      let content = "";
      try {
        content = await readFile(e.path);
      } catch {
        /* keep empty */
      }
      notes.push({
        id: m[1],
        path: e.path,
        title: parseNoteTitle(e.name, content),
      });
    }
  }
  useZettelIndexStore.getState().setAll(notes);
}

export function titleForId(id: string): string | undefined {
  return useZettelIndexStore.getState().byId[id]?.title;
}

// §95 Zettel index store — id ↔ title ↔ path mapping for notes/ + inbox/
import { create } from "zustand";

import { listDir, readFile } from "../../ipc/invoke";
import {
  extractLeadingId,
  firstBodyLine,
  parseNoteTitleInfo,
} from "../../utils/zettelkasten/parse-note-title";

export interface ZettelNote {
  id: string;
  path: string;
  title: string;
  /**
   * §99 True when `title` was borrowed from the note's first body line because
   * the note has no authored one (a fleeting `{id}.md` with no `title:`). Read
   * by `idForTitle`: a borrowed name must not make an authored one ambiguous.
   */
  titleFromBody?: boolean;
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

/**
 * Resolves the id ONLY when exactly one note has that title (case-insensitive);
 * null if 0 or ambiguous (>1).
 *
 * §99 Authored titles are considered first. The body-line fallback puts every
 * fleeting note into this namespace, and a quick capture whose first line
 * repeats an existing note's title ("회의록", "TODO", a person's name — the
 * typical shape of a capture) would otherwise turn a previously unambiguous
 * title ambiguous. The visible cost is not a wrong link but a MISSING one: B2
 * eager normalization (`wikilink.ts` InputRule/paste rule) falls through to the
 * typed target, and `[[회의록]]` is left dangling because the file on disk is
 * `202607051530 회의록.md`. A borrowed name yielding to an authored one keeps
 * that from happening, and captures stay resolvable when nothing else claims
 * the name.
 */
export function idForTitle(title: string): null | string {
  const q = title.trim().toLowerCase();
  const matches = Object.values(useZettelIndexStore.getState().byId).filter(
    (n) => n.title.toLowerCase() === q,
  );
  const authored = matches.filter((n) => !n.titleFromBody);
  const pool = authored.length > 0 ? authored : matches;
  return pool.length === 1 ? pool[0].id : null;
}

/**
 * §95 M2: Ensure the index is populated when a zettel note is opened directly
 * (file-tree, quick-switcher, wikilink) without the "zettelkasten" workspace
 * preset having been activated first — that activation path already calls
 * `refreshZettelIndex` itself, so this is a no-op unless the index is empty.
 * No-op for paths outside `zettelDir` or when `zettelDir` is unset.
 */
export async function maybeRefreshForPath(
  openedPath: string,
  zettelDir: null | string,
): Promise<void> {
  if (!zettelDir) return;
  if (!openedPath.startsWith(`${zettelDir}/`)) return;
  if (Object.keys(useZettelIndexStore.getState().byId).length > 0) return;
  await refreshZettelIndex(zettelDir);
}

/**
 * Scans notes/ + inbox/ under zettelDir, builds the id→note index, and replaces
 * the store's contents.
 *
 * ‼️ NON-RECURSIVE (`listDir(..., false)`), so a note in a subfolder is absent
 * from the index — and absence shows up on three surfaces at once: `[[`
 * autocomplete falls back to `parseNoteTitle(name, "")` (the id, for a bare-id
 * filename), the pill falls back to rendering the raw id, and export leaves
 * `[[id]]` bare. The app never creates such a note itself — quick capture writes
 * flat into `{zettelDir}/inbox/` — so this is only reachable by moving files by
 * hand or authoring them outside Baram.
 */
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
      const id = extractLeadingId(e.name);
      if (!id || !/\.(md|markdown)$/.test(e.name)) continue;
      let content = "";
      try {
        content = await readFile(e.path);
      } catch {
        /* keep empty */
      }
      notes.push({ id, path: e.path, ...noteTitle(e.name, content) });
    }
  }
  useZettelIndexStore.getState().setAll(notes);
}

export function titleForId(id: string): string | undefined {
  return useZettelIndexStore.getState().byId[id]?.title;
}

/**
 * §99 The indexed title, with a name for notes that have none.
 *
 * `parseNoteTitle` returns the **id itself** for a fleeting note (`{id}.md`, no
 * `title:` frontmatter) — that is not a name, and it is what every consumer of
 * this index then displayed: the `[[id]]` pill, the `[[` autocomplete list and
 * its search key, and export. §95 says the user neither types nor reads the id,
 * so fall back to the first body line — the same rule the hub inbox already
 * displays these notes by (§103).
 *
 * ‼️ The fallback fires only when the note has NO authored title — that fact
 * comes from `parseNoteTitleInfo`, never from comparing the title to the id.
 * The comparison is the obvious shortcut and it is wrong: a note whose real
 * title IS the id string (`title: 202607051530`, or `202607051530 202607051530.md`)
 * would have its authored title silently replaced by its first body line.
 *
 * ‼️ Deliberately narrower than the hub's `firstBodyLine(content) || parseNoteTitle(...)`.
 * This value is the "현재 제목" §95 renders into pills and exports, and for a titled
 * note that must stay the frontmatter/filename title even when the body opens
 * with something else. Widen this and a note's links start renaming themselves
 * as its first line is edited.
 *
 * ‼️ Not length-capped, and that is a constraint on this value rather than a
 * claim that nothing needs capping: a truncated title could not be found again
 * by `idForTitle` and would be written into exported `[[id|title]]`. Callers cap
 * at the point of DRAWING — `.wikilink-item-label` ellipsizes the autocomplete
 * row, and `wikilink-view.tsx` runs `capNoteTitle` on the pill. Anything new
 * that renders this value has to bring its own cap; there is no CSS truncation
 * on `.wikilink`, and export deliberately has none.
 */
function noteTitle(
  name: string,
  content: string,
): { title: string; titleFromBody?: boolean } {
  const { authored, title } = parseNoteTitleInfo(name, content);
  if (authored) return { title };
  const body = firstBodyLine(content);
  return body ? { title: body, titleFromBody: true } : { title };
}

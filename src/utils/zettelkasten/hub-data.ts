// §103 Zettel hub — pure data derivations for the hub panel (Task 4 renders them).
import type { FileEntry } from "../../ipc/types";

import { extractLeadingId, parseNoteTitle } from "./parse-note-title";

/**
 * Derive the "recent" list for the hub panel from a raw directory listing:
 * drop directories, keep only markdown files, sort newest-first by
 * `modifiedAt`, and take the top `limit`. Title is filename-derived only
 * (no content read) — recent is a cheap listing, unlike inbox. `id` is the
 * leading Zettelkasten id (if any) — used to key the favorite-toggle.
 */
export function recentFromEntries(
  entries: FileEntry[],
  limit: number,
): { id?: string; path: string; title: string }[] {
  return entries
    .filter((e) => !e.isDir && /\.(md|markdown)$/.test(e.name))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, limit)
    .map((e) => ({
      id: extractLeadingId(e.name) ?? undefined,
      path: e.path,
      title: parseNoteTitle(e.name, ""),
    }));
}

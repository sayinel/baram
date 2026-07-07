// §103 Zettel hub — pure data derivations for the hub panel (Task 4 renders them).
import type { FileEntry } from "../../ipc/types";

import { parseNoteTitle } from "./parse-note-title";

/**
 * Derive the "recent" list for the hub panel from a raw directory listing:
 * drop directories, keep only markdown files, sort newest-first by
 * `modifiedAt`, and take the top `limit`. Title is filename-derived only
 * (no content read) — recent is a cheap listing, unlike inbox.
 */
export function recentFromEntries(
  entries: FileEntry[],
  limit: number,
): { path: string; title: string }[] {
  return entries
    .filter((e) => !e.isDir && /\.(md|markdown)$/.test(e.name))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, limit)
    .map((e) => ({ path: e.path, title: parseNoteTitle(e.name, "") }));
}

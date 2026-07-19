import type { FileEntry } from "./file";

export type SortOrder = "mtime-asc" | "mtime-desc" | "name-asc" | "name-desc";

export const DEFAULT_SORT_ORDER: SortOrder = "name-asc";

/**
 * Folder-first is always fixed (§4.5). Within a group, order by the selected
 * key; equal/missing keys fall back to a stable name compare so ordering is
 * deterministic.
 */
export function compareEntries(
  a: FileEntry,
  b: FileEntry,
  order: SortOrder,
): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;

  let result: number;
  switch (order) {
    case "mtime-asc":
      result = (a.modifiedAt ?? 0) - (b.modifiedAt ?? 0);
      break;
    case "mtime-desc":
      result = (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0);
      break;
    case "name-asc":
      result = a.name.localeCompare(b.name);
      break;
    case "name-desc":
      result = b.name.localeCompare(a.name);
      break;
  }
  if (result === 0) result = a.name.localeCompare(b.name);
  return result;
}

/** Returns a new tree with every level sorted; does not mutate the input. */
export function sortTreeNodes(
  nodes: FileEntry[],
  order: SortOrder,
): FileEntry[] {
  return [...nodes]
    .sort((a, b) => compareEntries(a, b, order))
    .map((n) =>
      n.children ? { ...n, children: sortTreeNodes(n.children, order) } : n,
    );
}

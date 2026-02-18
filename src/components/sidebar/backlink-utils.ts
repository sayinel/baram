// §29 Backlink panel utility functions
import type { BacklinkEntry } from "../../ipc/types";

export interface BacklinkGroup {
  sourcePath: string;
  entries: BacklinkEntry[];
}

/** Group backlink entries by source file path */
export function groupBacklinksByFile(
  entries: BacklinkEntry[],
): BacklinkGroup[] {
  if (entries.length === 0) return [];

  const map = new Map<string, BacklinkEntry[]>();
  for (const entry of entries) {
    const existing = map.get(entry.sourcePath);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(entry.sourcePath, [entry]);
    }
  }

  return Array.from(map.entries()).map(([sourcePath, groupEntries]) => ({
    sourcePath,
    entries: groupEntries,
  }));
}

/** Extract file name from a full path */
export function extractFileNameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

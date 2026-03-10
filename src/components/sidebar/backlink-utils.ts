// §29 Backlink panel utility functions
import type { BacklinkEntry } from "../../ipc/types";

export interface BacklinkGroup {
  entries: BacklinkEntry[];
  sourcePath: string;
}

export interface NamespaceBacklinkGroup {
  fileGroups: BacklinkGroup[];
  namespace: string;
}

/** Extract file name from a full path */
export function extractFileNameFromPath(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/** §61 Extract namespace (directory relative to rootPath) from a full file path */
export function extractNamespaceFromPath(
  filePath: string,
  rootPath: string,
): string {
  let rel = filePath.startsWith(rootPath)
    ? filePath.slice(rootPath.length)
    : filePath;
  if (rel.startsWith("/")) rel = rel.slice(1);
  const lastSlash = rel.lastIndexOf("/");
  if (lastSlash <= 0) return "";
  return rel.substring(0, lastSlash);
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

/** §61 Group backlinks first by namespace, then by file within each namespace */
export function groupBacklinksByNamespace(
  entries: BacklinkEntry[],
  rootPath: string,
): NamespaceBacklinkGroup[] {
  // First, group by file
  const fileGroups = groupBacklinksByFile(entries);

  // Then group file groups by namespace
  const nsMap = new Map<string, BacklinkGroup[]>();
  for (const group of fileGroups) {
    const ns = extractNamespaceFromPath(group.sourcePath, rootPath);
    const existing = nsMap.get(ns);
    if (existing) {
      existing.push(group);
    } else {
      nsMap.set(ns, [group]);
    }
  }

  // Sort: root namespace last, then alphabetical
  return Array.from(nsMap.entries())
    .sort(([a], [b]) => {
      if (a === "" && b !== "") return 1;
      if (b === "" && a !== "") return -1;
      return a.localeCompare(b);
    })
    .map(([namespace, fileGroups]) => ({ namespace, fileGroups }));
}

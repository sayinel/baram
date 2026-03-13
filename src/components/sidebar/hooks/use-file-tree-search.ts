// §4.3 File tree — fuzzy/glob/tag search hook
import { useEffect, useMemo, useState } from "react";

import type { FileEntry } from "../../../stores/file-store";

import { getFilesByTag } from "../../../ipc/invoke";
import { useFileStore } from "../../../stores/file-store";
import {
  flattenFileTree,
  fuzzyMatch,
  fuzzyScore,
  globMatch,
  isGlobPattern,
} from "../../../utils/file-search";
import { logger } from "../../../utils/logger";

interface FlatFile {
  name: string;
  path: string;
  relativePath: string;
}

interface UseFileTreeSearchReturn {
  entryMatchesTagFilter: (entry: FileEntry, paths: Set<string>) => boolean;
  filteredPaths: null | Set<string>;
  searchQuery: string;
  searchResults: FlatFile[] | null;
  setSearchQuery: (q: string) => void;
}

export function useFileTreeSearch(): UseFileTreeSearchReturn {
  const fileTree = useFileStore((s) => s.fileTree);
  const rootPath = useFileStore((s) => s.rootPath);
  const tagFilter = useFileStore((s) => s.tagFilter);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredPaths, setFilteredPaths] = useState<null | Set<string>>(null);

  const searchResults = useMemo((): FlatFile[] | null => {
    const q = searchQuery.trim();
    if (!q || !rootPath) return null;
    const flat = flattenFileTree(fileTree, rootPath);
    if (isGlobPattern(q)) {
      return flat.filter(
        (f) => globMatch(q, f.name) || globMatch(q, f.relativePath),
      );
    }
    return flat
      .filter((f) => fuzzyMatch(q, f.name))
      .sort((a, b) => fuzzyScore(q, a.name) - fuzzyScore(q, b.name));
  }, [searchQuery, fileTree, rootPath]);

  // Tag filter: fetch matching file paths when tagFilter changes
  useEffect(() => {
    if (!tagFilter || !rootPath) {
      setFilteredPaths(null);
      return;
    }
    getFilesByTag(rootPath, tagFilter)
      .then((paths) => {
        const absSet = new Set(
          paths.map((p) => rootPath + "/" + p.replace(/\\/g, "/")),
        );
        setFilteredPaths(absSet);
      })
      .catch((err) => {
        logger.error("[FileTree] getFilesByTag failed:", err);
        setFilteredPaths(null);
      });
  }, [tagFilter, rootPath]);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    filteredPaths,
    entryMatchesTagFilter,
  };
}

/** Check if an entry or any descendant is in filteredPaths (pure function, no hooks) */
function entryMatchesTagFilter(entry: FileEntry, paths: Set<string>): boolean {
  if (!entry.isDir) return paths.has(entry.path);
  return (entry.children ?? []).some((child) =>
    entryMatchesTagFilter(child, paths),
  );
}

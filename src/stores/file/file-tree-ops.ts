import type { FileEntry as IpcFileEntry } from "../../ipc/types";
import type { FileEntry } from "./file";

import {
  compareEntries,
  DEFAULT_SORT_ORDER,
  type SortOrder,
} from "./file-tree-sort";

/**
 * Convert flat IPC FileEntry[] into nested tree structure.
 * Groups entries by parent directory, then recursively attaches children.
 * Directories sorted first, then per `order` (§4.5).
 */
export function buildFileTree(
  flatEntries: IpcFileEntry[],
  rootPath: string,
  order: SortOrder = DEFAULT_SORT_ORDER,
): FileEntry[] {
  // Group by parent path
  const childrenMap = new Map<string, IpcFileEntry[]>();
  for (const entry of flatEntries) {
    const parentPath = entry.path.substring(
      0,
      entry.path.length - entry.name.length - 1,
    );
    const list = childrenMap.get(parentPath) || [];
    list.push(entry);
    childrenMap.set(parentPath, list);
  }

  function buildChildren(parentPath: string): FileEntry[] {
    const entries = childrenMap.get(parentPath) || [];

    return entries
      .map((e) => {
        const node: FileEntry = {
          name: e.name,
          path: e.path,
          isDir: e.isDir,
          modifiedAt: e.modifiedAt,
        };
        if (e.isDir) {
          node.children = buildChildren(e.path);
        }
        return node;
      })
      .sort((a, b) => compareEntries(a, b, order));
  }

  return buildChildren(rootPath);
}

/**
 * Insert `newEntry` into `entries`, sorted by `order`. Idempotent — a no-op
 * if an entry with the same path already exists (canonical form; see
 * file-tree-ops.test.ts for the moveInTree scenario this protects).
 */
export function insertSorted(
  entries: FileEntry[],
  newEntry: FileEntry,
  order: SortOrder,
): FileEntry[] {
  if (entries.some((e) => e.path === newEntry.path)) return entries;
  const result = [...entries, newEntry];
  result.sort((a, b) => compareEntries(a, b, order));
  return result;
}

/**
 * Insert `entry` under the directory at `parentPath`, or at the top level
 * when `parentPath` is `rootPath`.
 */
export function addToTree(
  entries: FileEntry[],
  parentPath: string,
  rootPath: null | string,
  entry: FileEntry,
  order: SortOrder,
): FileEntry[] {
  if (parentPath === rootPath) {
    return insertSorted(entries, entry, order);
  }
  return entries.map((e) => {
    if (e.path === parentPath && e.isDir) {
      return { ...e, children: insertSorted(e.children || [], entry, order) };
    }
    if (e.isDir && e.children) {
      return {
        ...e,
        children: addToTree(e.children, parentPath, rootPath, entry, order),
      };
    }
    return e;
  });
}

/** Remove the entry at `path` (and its subtree, if a directory) from `entries`. */
export function removeFromTree(
  entries: FileEntry[],
  path: string,
): FileEntry[] {
  return entries
    .filter((e) => e.path !== path)
    .map((e) =>
      e.isDir && e.children
        ? { ...e, children: removeFromTree(e.children, path) }
        : e,
    );
}

/** Rewrite `path` for every descendant when their ancestor moves from `oldParentPath` to `newParentPath`. */
function rekeyChildrenPaths(
  children: FileEntry[],
  oldParentPath: string,
  newParentPath: string,
): FileEntry[] {
  return children.map((c) => {
    const childNewPath = newParentPath + c.path.slice(oldParentPath.length);
    const updated = { ...c, path: childNewPath };
    if (c.isDir && c.children) {
      updated.children = rekeyChildrenPaths(
        c.children,
        oldParentPath,
        newParentPath,
      );
    }
    return updated;
  });
}

/**
 * Rename the entry at `oldPath` to `newPath`/`newName`, rekeying descendant
 * paths when it's a directory.
 */
export function renameInTree(
  entries: FileEntry[],
  oldPath: string,
  newPath: string,
  newName: string,
): FileEntry[] {
  return entries.map((e) => {
    if (e.path === oldPath) {
      const result: FileEntry = { ...e, name: newName, path: newPath };
      if (e.isDir && e.children) {
        result.children = rekeyChildrenPaths(e.children, oldPath, newPath);
      }
      return result;
    }
    if (e.isDir && e.children) {
      return {
        ...e,
        children: renameInTree(e.children, oldPath, newPath, newName),
      };
    }
    return e;
  });
}

/** Find the tree node at `path`, searching directories recursively. */
export function findEntryByPath(
  entries: FileEntry[],
  path: string,
): FileEntry | null {
  for (const e of entries) {
    if (e.path === path) return e;
    if (e.isDir && e.children) {
      const found = findEntryByPath(e.children, path);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Move the entry at `oldPath` under `newParentPath`. Returns `null` when the
 * entry isn't found (caller should treat this as a no-op).
 *
 * The insertion at the destination reuses `insertSorted`, so it is
 * idempotent: if the destination already holds a *different* entry whose
 * computed path collides with the moved entry's new path, the pre-existing
 * tree node is kept and the moved entry is dropped rather than appended as
 * a duplicate path. This is reachable for a file-onto-file collision (a
 * file with the same name already lives in the target directory) — the
 * underlying filesystem rename succeeds there by overwriting the
 * destination file on disk. A directory-onto-directory collision can't
 * reach this path: `rename` fails on a non-empty destination directory, so
 * `moveFileEntry` is never called for that case. Pinned by
 * file-tree-ops.test.ts.
 */
export function moveInTree(
  entries: FileEntry[],
  oldPath: string,
  newParentPath: string,
  rootPath: null | string,
  order: SortOrder,
): null | { entries: FileEntry[]; newPath: string } {
  const entry = findEntryByPath(entries, oldPath);
  if (!entry) return null;

  const newPath = newParentPath + "/" + entry.name;
  const movedEntry: FileEntry = { ...entry, path: newPath };
  if (entry.isDir && entry.children) {
    movedEntry.children = rekeyChildrenPaths(entry.children, oldPath, newPath);
  }

  const withoutOld = removeFromTree(entries, oldPath);
  const result = addToTree(
    withoutOld,
    newParentPath,
    rootPath,
    movedEntry,
    order,
  );
  return { entries: result, newPath };
}

/**
 * Rewrite `openFiles` keys under `oldPrefix` to `newPrefix` — shared by
 * rename (parent unchanged, name/path changed) and move (parent changed).
 */
export function rekeyOpenFilesPrefix(
  openFiles: Map<string, string>,
  oldPrefix: string,
  newPrefix: string,
): Map<string, string> {
  const next = new Map(openFiles);
  for (const [key, value] of openFiles) {
    if (key === oldPrefix || key.startsWith(oldPrefix + "/")) {
      next.delete(key);
      next.set(newPrefix + key.slice(oldPrefix.length), value);
    }
  }
  return next;
}

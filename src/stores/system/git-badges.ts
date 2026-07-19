import type { GitChange } from "../../ipc/types";

import { dirname } from "../../utils/path-utils";

export interface GitBadgeIndex {
  dirs: Set<string>;
  files: Map<string, GitBadgeStatus>;
}

export type GitBadgeStatus = "added" | "modified";

export const EMPTY_GIT_BADGE_INDEX: GitBadgeIndex = {
  files: new Map(),
  dirs: new Set(),
};

/**
 * Reduce the git store's `changes` (repo-relative, possibly duplicated) into a
 * badge index keyed by ABSOLUTE path. Changes outside the vault `rootPath` are
 * ignored. Folders roll up any change (including deletions) under them.
 */
export function buildGitBadgeIndex(
  changes: GitChange[],
  repoRoot: null | string,
  rootPath: null | string,
): GitBadgeIndex {
  if (!repoRoot || !rootPath) return { files: new Map(), dirs: new Set() };

  const root = toBadgeKey(repoRoot).replace(/\/+$/, "");
  const files = new Map<string, GitBadgeStatus>();
  const dirs = new Set<string>();
  const rp = toBadgeKey(rootPath);
  const underRoot = rp + "/";

  for (const change of changes) {
    const abs = `${root}/${toBadgeKey(change.path)}`;
    if (!abs.startsWith(underRoot)) continue; // outside the vault — not in tree

    const badge = badgeFor(change.status);
    if (badge) {
      // modified wins over added on collision
      const prev = files.get(abs);
      if (prev !== "modified") files.set(abs, badge);
    }

    // roll up to every ancestor dir strictly between the file and rootPath
    let dir = dirname(abs);
    while (dir.length > rp.length && dir.startsWith(underRoot)) {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }

  return { files, dirs };
}

/** Normalize a path to forward slashes so Windows (backslash) tree paths
    match libgit2's forward-slash change paths. No-op on macOS/Linux. */
export function toBadgeKey(path: string): string {
  return path.replace(/\\/g, "/");
}

function badgeFor(status: string): GitBadgeStatus | null {
  switch (status) {
    case "added":
    case "untracked":
      return "added";
    case "modified":
    case "renamed":
      return "modified";
    default:
      return null; // deleted (and anything unknown) → no file badge
  }
}

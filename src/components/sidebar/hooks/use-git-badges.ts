import { useEffect, useMemo, useRef } from "react";

// §4.5 File-tree git status badges — debounced refresh driven by file-watcher events.
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { useShallow } from "zustand/shallow";

import { useGitStore } from "../../../stores/system/git";
import {
  buildGitBadgeIndex,
  EMPTY_GIT_BADGE_INDEX,
  type GitBadgeIndex,
} from "../../../stores/system/git-badges";

const REFRESH_DEBOUNCE_MS = 1000;

/**
 * Derives the git badge index for the file tree from the git store, and keeps
 * it fresh by debounce-refreshing on Tauri file-watcher events
 * (file:created/deleted/changed).
 */
export function useGitBadges(rootPath: null | string): GitBadgeIndex {
  const { changes, isRepo, repoRoot } = useGitStore(
    useShallow((s) => ({
      changes: s.changes,
      isRepo: s.isRepo,
      repoRoot: s.repoRoot,
    })),
  );

  // Initial + rootPath-change refresh.
  useEffect(() => {
    if (!rootPath) return;
    void useGitStore.getState().refresh(rootPath);
  }, [rootPath]);

  // Debounced refresh on file-watcher events.
  const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  useEffect(() => {
    if (!rootPath) return;
    const unlistenFns: UnlistenFn[] = [];
    let cleanedUp = false;

    const schedule = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void useGitStore.getState().refresh(rootPath);
      }, REFRESH_DEBOUNCE_MS);
    };

    void (async () => {
      const fns = await Promise.all([
        listen("file:created", schedule),
        listen("file:deleted", schedule),
        listen("file:changed", schedule),
      ]);
      if (cleanedUp) {
        for (const fn of fns) fn();
        return;
      }
      unlistenFns.push(...fns);
    })();

    return () => {
      cleanedUp = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const fn of unlistenFns) fn();
    };
  }, [rootPath]);

  return useMemo(
    () =>
      isRepo
        ? buildGitBadgeIndex(changes, repoRoot, rootPath)
        : EMPTY_GIT_BADGE_INDEX,
    [isRepo, changes, repoRoot, rootPath],
  );
}

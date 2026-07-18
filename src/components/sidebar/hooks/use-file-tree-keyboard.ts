// §4.4 File tree — 키보드 내비게이션 훅 (focusedPath roving + keydown 디스패치)
import { useCallback, useState } from "react";

import type { NavEntry } from "../file-tree-keyboard-nav";

import {
  firstChildPath,
  isDirPath,
  nextPath,
  parentPath,
  prevPath,
} from "../file-tree-keyboard-nav";

export interface UseFileTreeKeyboardArgs {
  expandDir: (path: string) => void;
  expandedDirs: Set<string>;
  navEntries: NavEntry[];
  onOpenFile: (path: string) => void;
  rootPath: string;
  selectRange: (targetPath: string, visiblePaths: string[]) => void;
  selectSingle: (path: string) => void;
  toggleExpandedDir: (path: string) => void;
  visiblePaths: string[];
}

export interface UseFileTreeKeyboardReturn {
  focusedPath: null | string;
  handleNavKeyDown: (e: React.KeyboardEvent) => void;
  setFocusedPath: (path: null | string) => void;
}

export function useFileTreeKeyboard(
  args: UseFileTreeKeyboardArgs,
): UseFileTreeKeyboardReturn {
  const {
    navEntries,
    visiblePaths,
    rootPath,
    expandedDirs,
    expandDir,
    toggleExpandedDir,
    selectSingle,
    selectRange,
    onOpenFile,
  } = args;
  const [focusedPath, setFocusedPath] = useState<null | string>(null);

  const moveFocus = useCallback(
    (target: null | string, shift: boolean): void => {
      if (!target) return;
      setFocusedPath(target);
      if (shift) selectRange(target, visiblePaths);
      else selectSingle(target);
    },
    [selectRange, selectSingle, visiblePaths],
  );

  const handleNavKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveFocus(nextPath(visiblePaths, focusedPath), e.shiftKey);
          break;
        case "ArrowLeft": {
          if (!focusedPath) break;
          e.preventDefault();
          if (
            isDirPath(navEntries, focusedPath) &&
            expandedDirs.has(focusedPath)
          ) {
            toggleExpandedDir(focusedPath);
          } else {
            const parent = parentPath(navEntries, focusedPath, rootPath);
            if (parent) moveFocus(parent, false);
          }
          break;
        }
        case "ArrowRight": {
          if (!focusedPath || !isDirPath(navEntries, focusedPath)) break;
          e.preventDefault();
          if (!expandedDirs.has(focusedPath)) {
            expandDir(focusedPath);
          } else {
            const child = firstChildPath(navEntries, focusedPath);
            if (child) moveFocus(child, false);
          }
          break;
        }
        case "ArrowUp":
          e.preventDefault();
          moveFocus(prevPath(visiblePaths, focusedPath), e.shiftKey);
          break;
        case "Enter":
          if (!focusedPath) break;
          e.preventDefault();
          if (isDirPath(navEntries, focusedPath))
            toggleExpandedDir(focusedPath);
          else onOpenFile(focusedPath);
          break;
      }
    },
    [
      focusedPath,
      navEntries,
      visiblePaths,
      rootPath,
      expandedDirs,
      expandDir,
      toggleExpandedDir,
      onOpenFile,
      moveFocus,
    ],
  );

  return { focusedPath, setFocusedPath, handleNavKeyDown };
}

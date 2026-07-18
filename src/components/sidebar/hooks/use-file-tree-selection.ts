// §4.3 File tree — 멀티 셀렉트 상태 훅 (단일/토글/범위 선택)
import { useCallback, useRef, useState } from "react";

export interface UseFileTreeSelectionReturn {
  clearSelection: () => void;
  selectedPaths: Set<string>;
  selectRange: (targetPath: string, visiblePaths: string[]) => void;
  selectSingle: (path: string) => void;
  toggleSelect: (path: string) => void;
}

export function useFileTreeSelection(): UseFileTreeSelectionReturn {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  // Shift 범위 선택의 기준점 — selectRange는 갱신하지 않는다
  const anchorRef = useRef<null | string>(null);

  const selectSingle = useCallback((path: string): void => {
    anchorRef.current = path;
    setSelectedPaths(new Set([path]));
  }, []);

  const toggleSelect = useCallback((path: string): void => {
    anchorRef.current = path;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectRange = useCallback(
    (targetPath: string, visiblePaths: string[]): void => {
      const anchor = anchorRef.current;
      const anchorIdx = anchor ? visiblePaths.indexOf(anchor) : -1;
      const targetIdx = visiblePaths.indexOf(targetPath);
      if (anchorIdx === -1 || targetIdx === -1) {
        anchorRef.current = targetPath;
        setSelectedPaths(new Set([targetPath]));
        return;
      }
      const [lo, hi] =
        anchorIdx <= targetIdx
          ? [anchorIdx, targetIdx]
          : [targetIdx, anchorIdx];
      setSelectedPaths(new Set(visiblePaths.slice(lo, hi + 1)));
    },
    [],
  );

  const clearSelection = useCallback((): void => {
    anchorRef.current = null;
    setSelectedPaths(new Set());
  }, []);

  return {
    selectedPaths,
    selectSingle,
    toggleSelect,
    selectRange,
    clearSelection,
  };
}

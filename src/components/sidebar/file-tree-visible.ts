// §4.3 File tree — 렌더 순서와 동일한 가시 항목 평탄화
// Shift 범위 선택(use-file-tree-selection)과 키보드 내비게이션이 이 순서를 공유한다.
import type { FileEntry } from "../../stores/file/file";

/**
 * 파일 트리를 실제 렌더되는 행 순서로 평탄화한다.
 * 최상위는 태그 필터를 적용하고, 펼쳐진 폴더만 자식을 노출하며,
 * 자식은 태그 필터를 적용하지 않는다 (FileTree.tsx 렌더 로직과 동일).
 */
export function computeVisibleEntries(
  tree: FileEntry[],
  expandedDirs: Set<string>,
  filteredPaths: null | Set<string>,
  matchesTagFilter: (entry: FileEntry, paths: Set<string>) => boolean,
): FileEntry[] {
  const roots = filteredPaths
    ? tree.filter((e) => matchesTagFilter(e, filteredPaths))
    : tree;
  const out: FileEntry[] = [];
  const walk = (entries: FileEntry[]): void => {
    for (const e of entries) {
      out.push(e);
      if (e.isDir && expandedDirs.has(e.path) && e.children) {
        walk(e.children);
      }
    }
  };
  walk(roots);
  return out;
}

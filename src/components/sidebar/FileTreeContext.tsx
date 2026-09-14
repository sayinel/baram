// §4.3 File tree — Context Provider for shared read-only state
// Eliminates props drilling of 6 frequently-read states through FileTreeNode
import { createContext, useContext } from "react";

import type { GitBadgeIndex } from "../../stores/system/git-badges";
import type { CreatingEntryState } from "./file-tree-types";

export interface FileTreeContextValue {
  creatingEntry: CreatingEntryState | null;
  dragOverPath: null | string;
  dragSourcePaths: string[];
  expandedDirs: Set<string>;
  focusedPath: null | string;
  gitBadges: GitBadgeIndex;
  renamingPath: null | string;
  selectedPaths: Set<string>;
}

/**
 * ‼️ `FileTreeContext.Provider` 를 `FileTreeProvider` 같은 이름으로 재export 하지 말 것 —
 * 이유는 `contexts/editor-context.tsx` 의 같은 주석에 있다(요약: 그 별칭이 이 파일을
 * 컴포넌트 모듈로 만들어 `useFileTreeContext` 가 react-refresh 위반으로 보고된다).
 *
 * 소비자는 컨텍스트를 그대로 렌더한다: `<FileTreeContext value={ctxValue}>`.
 */
export const FileTreeContext = createContext<FileTreeContextValue | null>(null);

export function useFileTreeContext(): FileTreeContextValue {
  const ctx = useContext(FileTreeContext);
  if (!ctx) {
    throw new Error(
      "useFileTreeContext must be used within a FileTreeContext provider",
    );
  }
  return ctx;
}

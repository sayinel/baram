// §4.3 File tree — shared type definitions

export interface ContextMenuState {
  selectionCount: number;
  selectionHasDir: boolean;
  targetIsDir: boolean;
  targetPath: null | string;
  x: number;
  y: number;
}

export interface CreatingEntryState {
  isDir: boolean;
  parentPath: string;
}

export interface DragState {
  active: boolean;
  /** 단일 드래그 시 고스트에 표시할 파일명 */
  sourceName: string;
  sourcePaths: string[];
  startX: number;
  startY: number;
}

// --- Constants (magic numbers extracted) ---
export const DRAG_EXPAND_DELAY_MS = 600;
export const DRAG_THRESHOLD_PX = 5;
export const GHOST_OFFSET_X = 12;
export const GHOST_OFFSET_Y = -10;
/**
 * §365 파일 트리 한 행의 왼쪽 들여쓰기 — 깊이마다 `--space-4`, 기본 `--space-2`.
 * 인라인 style 에 남는 이유: 깊이는 행마다 다른 데이터다. 단위를 토큰으로 두어
 * 밀도 다이얼이 들여쓰기에도 닿는다. 기본 단에서 `depth × 16 + 8` px 와 같다.
 */
export const treeIndent = (depth: number): string =>
  `calc(${depth} * var(--space-4) + var(--space-2))`;

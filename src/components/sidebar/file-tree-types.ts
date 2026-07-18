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
export const TREE_INDENT_PX = 16;
export const TREE_BASE_PADDING_PX = 8;

/** Data attribute selector for the editor scroll container */
export const EDITOR_SCROLL_SELECTOR = "[data-editor-scroll]";

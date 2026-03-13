// §4.3 File tree — shared type definitions
import type { FileEntry } from "../../stores/file-store";

export interface ContextMenuState {
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
  sourceName: string;
  sourcePath: string;
  startX: number;
  startY: number;
}

export interface FileTreeNodeProps {
  depth: number;
  entry: FileEntry;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onFileClick: (entry: FileEntry) => void;
  onToggleDir: (path: string) => void;
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

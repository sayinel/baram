// §4.3 File tree — mouse-based drag and drop hook
// HTML5 DnD API does not work reliably in Tauri WKWebView.
// Instead: mousedown on file -> mousemove (threshold) -> mouseup on folder = move.
// Files detected via data-file-path, folders via data-drop-path, using elementFromPoint.
import { useCallback, useEffect, useRef, useState } from "react";

import type { DragState } from "../file-tree-types";
import type { Editor } from "@tiptap/react";

import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import {
  hideDropIndicator,
  insertNodeAtPos,
  resolveInsertTarget,
  showDropIndicator,
} from "../../../utils/editor/drop-indicator";
import { getRelativePath, isImageFile } from "../../../utils/path-utils";
import { resolveDragSet } from "../file-tree-multi-ops";
import {
  DRAG_THRESHOLD_PX,
  EDITOR_SCROLL_SELECTOR,
  GHOST_OFFSET_X,
  GHOST_OFFSET_Y,
} from "../file-tree-types";
import { useFileTreeMove } from "./use-file-tree-move";

interface UseFileTreeDnDReturn {
  dragOverPath: null | string;
  dragSourcePaths: string[];
  handleTreeMouseDown: (e: React.MouseEvent) => void;
  isDragging: boolean;
  suppressClickRef: React.RefObject<boolean>;
}

export function useFileTreeDnD(
  editor: Editor | null | undefined,
  selectedPaths: Set<string>,
): UseFileTreeDnDReturn {
  const { moveEntries } = useFileTreeMove();

  const [dragOverPath, setDragOverPath] = useState<null | string>(null);
  const [dragSourcePaths, setDragSourcePaths] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  // Create / destroy floating drag ghost (DOM-based, not React -- avoids re-renders on every mousemove)
  const createDragGhost = useCallback(
    (name: string, x: number, y: number): void => {
      const ghost = document.createElement("div");
      ghost.className = "file-tree-drag-ghost";
      ghost.textContent = name;
      ghost.style.left = `${x + GHOST_OFFSET_X}px`;
      ghost.style.top = `${y + GHOST_OFFSET_Y}px`;
      document.body.appendChild(ghost);
      dragGhostRef.current = ghost;
    },
    [],
  );

  const removeDragGhost = useCallback((): void => {
    if (dragGhostRef.current) {
      dragGhostRef.current.remove();
      dragGhostRef.current = null;
    }
  }, []);

  // Document-level mousemove/mouseup for DnD
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent): void => {
      const state = dragRef.current;
      if (!state) return;
      if (!state.active) {
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD_PX) return;
        state.active = true;
        setIsDragging(true);
        setDragSourcePaths(state.sourcePaths);
        // Clear any text selection that started between mousedown and threshold
        window.getSelection()?.removeAllRanges();
        createDragGhost(
          state.sourcePaths.length > 1
            ? `${state.sourcePaths.length} items`
            : state.sourceName,
          e.clientX,
          e.clientY,
        );
      }
      // Prevent text selection -- must preventDefault on EVERY mousemove, not just once
      e.preventDefault();
      // Move ghost
      const ghost = dragGhostRef.current;
      if (ghost) {
        ghost.style.left = `${e.clientX + GHOST_OFFSET_X}px`;
        ghost.style.top = `${e.clientY + GHOST_OFFSET_Y}px`;
      }
      // Detect folder under cursor (ghost has pointer-events:none so elementFromPoint sees through it)
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const folderEl = el?.closest<HTMLElement>("[data-drop-path]");
      setDragOverPath(folderEl?.dataset.dropPath ?? null);

      const singleSource =
        state.sourcePaths.length === 1 ? state.sourcePaths[0] : null;

      // Feature 3: editor drop indicator bar for image files
      if (editor && singleSource && isImageFile(singleSource)) {
        const scrollEl = document.querySelector(EDITOR_SCROLL_SELECTOR);
        const scrollRect = scrollEl?.getBoundingClientRect();
        if (
          scrollRect &&
          e.clientX >= scrollRect.left &&
          e.clientX <= scrollRect.right &&
          e.clientY >= scrollRect.top &&
          e.clientY <= scrollRect.bottom
        ) {
          const target = resolveInsertTarget(editor, e.clientX, e.clientY);
          if (target) showDropIndicator(target);
          else hideDropIndicator();
        } else {
          hideDropIndicator();
        }
      }
    };

    const handleMouseUp = async (e: MouseEvent): Promise<void> => {
      const state = dragRef.current;
      if (!state) return;
      dragRef.current = null;
      removeDragGhost();
      hideDropIndicator();

      if (!state.active) {
        setIsDragging(false);
        setDragSourcePaths([]);
        return; // Was a click, not a drag -- let onClick handle it
      }

      // Suppress the click event that fires after mouseup
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      setIsDragging(false);
      setDragSourcePaths([]);
      setDragOverPath(null);

      const currentRootPath = useFileStore.getState().rootPath;
      if (!currentRootPath) return;

      const singleSource =
        state.sourcePaths.length === 1 ? state.sourcePaths[0] : null;

      // Feature 3: Drop image file onto editor -- insert relative-path image
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const scrollEl = document.querySelector(EDITOR_SCROLL_SELECTOR);
      const scrollRect = scrollEl?.getBoundingClientRect();
      const overEditor =
        scrollRect &&
        e.clientX >= scrollRect.left &&
        e.clientX <= scrollRect.right &&
        e.clientY >= scrollRect.top &&
        e.clientY <= scrollRect.bottom;
      if (overEditor && editor && singleSource && isImageFile(singleSource)) {
        const { activeTabId: tabId, tabs: currentTabs } =
          useEditorStore.getState();
        const tab = currentTabs.find((t) => t.id === tabId);
        if (tab?.filePath) {
          const fileDir = tab.filePath.substring(
            0,
            tab.filePath.lastIndexOf("/"),
          );
          const relativeSrc = getRelativePath(fileDir, singleSource);
          const fileName = singleSource.split("/").pop() ?? "";

          const target = resolveInsertTarget(editor, e.clientX, e.clientY);
          const insertPos = target?.pos ?? editor.state.doc.content.size;

          const imageNode = editor.state.schema.nodes.image.create({
            src: relativeSrc,
            alt: fileName.replace(/\.[^.]+$/, ""),
          });
          insertNodeAtPos(editor, insertPos, imageNode);
        }
        return; // Skip folder move logic
      }

      // Multi-item drag released over the editor: no-op (do not fall through to a root move)
      if (overEditor && state.sourcePaths.length > 1) return;

      // Determine drop target folder
      const folderEl = el?.closest<HTMLElement>("[data-drop-path]");
      const targetPath = folderEl?.dataset.dropPath || currentRootPath;

      await moveEntries(state.sourcePaths, targetPath);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      hideDropIndicator();
      removeDragGhost(); // cleanup on unmount
    };
  }, [editor, moveEntries, createDragGhost, removeDragGhost]);

  // Start drag from file items via mousedown on root (event delegation)
  const handleTreeMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      if (e.button !== 0) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const fileEl = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-file-path]",
      );
      if (!fileEl?.dataset.filePath) return;
      const parts = fileEl.dataset.filePath.split("/");
      dragRef.current = {
        sourcePaths: resolveDragSet(fileEl.dataset.filePath, selectedPaths),
        sourceName: parts[parts.length - 1],
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };
    },
    [selectedPaths],
  );

  return {
    dragOverPath,
    dragSourcePaths,
    isDragging,
    handleTreeMouseDown,
    suppressClickRef,
  };
}

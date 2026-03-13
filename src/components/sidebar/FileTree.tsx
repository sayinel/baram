// §4.3 File tree sidebar — directory browsing + file opening
// §33 Inline rename with wikilink auto-update
// File management: context menu, inline creation, delete, drag-and-drop
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { Editor } from "@tiptap/react";

import {
  createDir,
  deleteDir,
  deleteFile,
  getFilesByTag,
  readFile,
  renameFile,
  renameFileWithLinks,
  renameNamespace,
  writeFile,
} from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import {
  type FileEntry,
  openFolder,
  useFileStore,
} from "../../stores/file-store";
import { useLinkStore } from "../../stores/link-store";
import { showConfirm } from "../../utils/confirm-dialog";
import {
  hideDropIndicator,
  insertNodeAtPos,
  resolveInsertTarget,
  showDropIndicator,
} from "../../utils/drop-indicator";
import {
  flattenFileTree,
  fuzzyMatch,
  fuzzyScore,
  globMatch,
  isGlobPattern,
} from "../../utils/file-search";
import { logger } from "../../utils/logger";
import { getRelativePath, isImageFile } from "../../utils/path-utils";

// --- Mono-style SVG Icons (Lucide-based, 24x24 viewBox) ---
const S = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};

// --- Types ---
interface ContextMenuState {
  targetIsDir: boolean;
  targetPath: null | string;
  x: number;
  y: number;
}

interface CreatingEntryState {
  isDir: boolean;
  parentPath: string;
}

// --- FileTree (main component) ---
export function FileTree({ editor }: { editor?: Editor | null }) {
  const {
    fileTree,
    rootPath,
    setFileContent,
    renameFileEntry,
    addFileEntry,
    removeFileEntry,
    moveFileEntry,
  } = useFileStore();
  const tagFilter = useFileStore((s) => s.tagFilter);
  const setTagFilter = useFileStore((s) => s.setTagFilter);
  const expandedDirs = useFileStore((s) => s.expandedDirs);
  const toggleExpandedDir = useFileStore((s) => s.toggleExpandedDir);
  const expandDir = useFileStore((s) => s.expandDir);
  const { openTab, tabs, activeTabId, closeTab, renameTab } = useEditorStore();
  const [renamingPath, setRenamingPath] = useState<null | string>(null);
  const [selectedPath, setSelectedPath] = useState<null | string>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [creatingEntry, setCreatingEntry] = useState<CreatingEntryState | null>(
    null,
  );
  const [dragOverPath, setDragOverPath] = useState<null | string>(null);
  const [dragSourcePath, setDragSourcePath] = useState<null | string>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [filteredPaths, setFilteredPaths] = useState<null | Set<string>>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<null | {
    active: boolean;
    sourceName: string;
    sourcePath: string;
    startX: number;
    startY: number;
  }>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q || !rootPath) return null;
    const flat = flattenFileTree(fileTree, rootPath);
    if (isGlobPattern(q)) {
      return flat.filter(
        (f) => globMatch(q, f.name) || globMatch(q, f.relativePath),
      );
    }
    return flat
      .filter((f) => fuzzyMatch(q, f.name))
      .sort((a, b) => fuzzyScore(q, a.name) - fuzzyScore(q, b.name));
  }, [searchQuery, fileTree, rootPath]);

  // Tag filter helper: check if an entry or any descendant is in filteredPaths
  const entryMatchesTagFilter = useCallback(
    (entry: FileEntry, paths: Set<string>): boolean => {
      if (!entry.isDir) return paths.has(entry.path);
      return (entry.children ?? []).some((child) =>
        entryMatchesTagFilter(child, paths),
      );
    },
    [],
  );

  // Tag filter: fetch matching file paths when tagFilter changes
  useEffect(() => {
    if (!tagFilter || !rootPath) {
      setFilteredPaths(null);
      return;
    }
    getFilesByTag(rootPath, tagFilter)
      .then((paths) => {
        // Normalize path separators and build a Set of absolute paths
        const absSet = new Set(
          paths.map((p) => rootPath + "/" + p.replace(/\\/g, "/")),
        );
        setFilteredPaths(absSet);
      })
      .catch((err) => {
        logger.error("[FileTree] getFilesByTag failed:", err);
        setFilteredPaths(null);
      });
  }, [tagFilter, rootPath]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeFilePath = activeTab?.filePath ?? null;
  useEffect(() => {
    if (activeFilePath) setSelectedPath(activeFilePath);
  }, [activeFilePath]);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // Auto-expand folders after 600ms hover during drag
  useEffect(() => {
    if (!dragOverPath) return;
    const timer = setTimeout(() => {
      expandDir(dragOverPath);
    }, 600);
    return () => clearTimeout(timer);
  }, [dragOverPath, expandDir]);

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "F2" && selectedPath && !renamingPath) {
        e.preventDefault();
        setRenamingPath(selectedPath);
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedPath &&
        !renamingPath &&
        e.metaKey
      ) {
        e.preventDefault();
        handleDelete(selectedPath);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedPath, renamingPath],
  );

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true });
    if (selected) await openFolder(selected);
  }, []);

  const handleToggleDir = useCallback(
    (path: string) => {
      toggleExpandedDir(path);
    },
    [toggleExpandedDir],
  );

  const handleFileClick = useCallback(
    async (entry: FileEntry) => {
      if (suppressClickRef.current) return;
      setSelectedPath(entry.path);
      treeRef.current?.focus();
      const existing = tabs.find((t) => t.filePath === entry.path);
      if (existing) {
        useEditorStore.getState().setActiveTab(existing.id);
        return;
      }
      try {
        const content = await readFile(entry.path);
        setFileContent(entry.path, content);
        openTab({
          id: crypto.randomUUID(),
          filePath: entry.path,
          title: entry.name,
          isDirty: false,
          isPinned: false,
        });
      } catch (err) {
        logger.error("[FileTree] Failed to read file:", err);
      }
    },
    [tabs, setFileContent, openTab],
  );

  const handleStartRename = useCallback(
    (path: string) => setRenamingPath(path),
    [],
  );

  const handleCancelRename = useCallback(() => {
    setRenamingPath(null);
    treeRef.current?.focus();
  }, []);

  const handleConfirmRename = useCallback(
    async (oldPath: string, newName: string) => {
      setRenamingPath(null);
      treeRef.current?.focus();
      const parts = oldPath.split("/");
      const oldName = parts[parts.length - 1];
      if (newName === oldName || !newName.trim()) return;
      const newPath =
        oldPath.substring(0, oldPath.length - oldName.length) + newName;

      // Check if this is a directory rename
      const isDir = (() => {
        function find(entries: FileEntry[]): boolean {
          for (const e of entries) {
            if (e.path === oldPath) return e.isDir;
            if (e.isDir && e.children && find(e.children)) return true;
          }
          return false;
        }
        return find(fileTree);
      })();

      try {
        if (isDir && rootPath) {
          // §61 Namespace rename: directory + relative wikilink updates
          const result = await renameNamespace(oldPath, newPath, rootPath);
          renameFileEntry(oldPath, newPath, newName);
          useEditorStore.getState().renameDirInTabs(oldPath, newPath);
          setSelectedPath(newPath);
          // Reload content for files that had wikilinks updated
          const { openFiles } = useFileStore.getState();
          for (const updatedFile of result.updatedFiles) {
            if (openFiles.has(updatedFile)) {
              try {
                const newContent = await readFile(updatedFile);
                useFileStore.getState().setFileContent(updatedFile, newContent);
              } catch {
                /* ignore */
              }
            }
          }
          useLinkStore.getState().invalidate();
        } else {
          // Single file rename (existing behavior)
          const result = await renameFileWithLinks(oldPath, newPath);
          renameFileEntry(oldPath, newPath, newName);
          renameTab(oldPath, newPath, newName);
          setSelectedPath(newPath);
          const { openFiles } = useFileStore.getState();
          if (openFiles.has(oldPath)) {
            const content = openFiles.get(oldPath)!;
            useFileStore.getState().removeFileContent(oldPath);
            useFileStore.getState().setFileContent(newPath, content);
          }
          for (const updatedFile of result.updatedFiles) {
            if (openFiles.has(updatedFile)) {
              try {
                const newContent = await readFile(updatedFile);
                useFileStore.getState().setFileContent(updatedFile, newContent);
              } catch {
                /* ignore */
              }
            }
          }
          useLinkStore.getState().invalidate();
        }
      } catch (err) {
        logger.error("[FileTree] Rename failed:", err);
      }
    },
    [renameFileEntry, renameTab, fileTree, rootPath],
  );

  // --- Context menu ---
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isDir: boolean) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        targetPath: path,
        targetIsDir: isDir,
      });
    },
    [],
  );

  const handleEmptyAreaContextMenu = useCallback((e: React.MouseEvent) => {
    if (
      e.target === e.currentTarget ||
      (e.target as HTMLElement).classList.contains("file-tree")
    ) {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        targetPath: null,
        targetIsDir: false,
      });
    }
  }, []);

  // --- Delete ---
  const handleDelete = useCallback(
    async (path: string) => {
      if (!rootPath) return;
      function findEntry(entries: FileEntry[]): FileEntry | null {
        for (const e of entries) {
          if (e.path === path) return e;
          if (e.isDir && e.children) {
            const found = findEntry(e.children);
            if (found) return found;
          }
        }
        return null;
      }
      const entry = findEntry(useFileStore.getState().fileTree);
      if (!entry) return;
      const confirmed = await showConfirm(
        entry.isDir
          ? `Delete folder "${entry.name}" and all its contents?`
          : `Delete file "${entry.name}"?`,
      );
      if (!confirmed) return;
      try {
        if (entry.isDir) await deleteDir(path);
        else await deleteFile(path);
        const { tabs: currentTabs } = useEditorStore.getState();
        for (const tab of currentTabs) {
          if (tab.filePath === path || tab.filePath?.startsWith(path + "/"))
            closeTab(tab.id);
        }
        removeFileEntry(path);
        useLinkStore.getState().invalidate();
      } catch (err) {
        logger.error("[FileTree] Delete failed:", err);
      }
    },
    [rootPath, closeTab, removeFileEntry],
  );

  // --- Inline create ---
  const handleStartCreate = useCallback(
    (parentPath: string, isDir: boolean) => {
      if (parentPath !== rootPath) {
        expandDir(parentPath);
      }
      setCreatingEntry({ parentPath, isDir });
    },
    [rootPath, expandDir],
  );

  const handleConfirmCreate = useCallback(
    async (name: string) => {
      if (!creatingEntry || !name.trim()) {
        setCreatingEntry(null);
        return;
      }
      const { parentPath, isDir } = creatingEntry;
      const fullPath = parentPath + "/" + name.trim();
      setCreatingEntry(null);
      try {
        if (isDir) {
          await createDir(fullPath);
          addFileEntry(parentPath, {
            name: name.trim(),
            path: fullPath,
            isDir: true,
            children: [],
          });
        } else {
          await writeFile(fullPath, "");
          addFileEntry(parentPath, {
            name: name.trim(),
            path: fullPath,
            isDir: false,
          });
          setFileContent(fullPath, "");
          openTab({
            id: crypto.randomUUID(),
            filePath: fullPath,
            title: name.trim(),
            isDirty: false,
            isPinned: false,
          });
        }
      } catch (err) {
        logger.error("[FileTree] Create failed:", err);
      }
    },
    [creatingEntry, addFileEntry, setFileContent, openTab],
  );

  const handleCancelCreate = useCallback(() => setCreatingEntry(null), []);

  // --- Mouse-based drag and drop ---
  // HTML5 DnD API does not work reliably in Tauri WKWebView.
  // Instead: mousedown on file → mousemove (threshold) → mouseup on folder = move.
  // Files detected via data-file-path, folders via data-drop-path, using elementFromPoint.
  // elementFromPoint works correctly with mouse events (no drag ghost interference).

  // Create / destroy floating drag ghost (DOM-based, not React — avoids re-renders on every mousemove)
  const createDragGhost = useCallback((name: string, x: number, y: number) => {
    const ghost = document.createElement("div");
    ghost.className = "file-tree-drag-ghost";
    ghost.textContent = name;
    ghost.style.left = `${x + 12}px`;
    ghost.style.top = `${y - 10}px`;
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;
  }, []);

  const removeDragGhost = useCallback(() => {
    if (dragGhostRef.current) {
      dragGhostRef.current.remove();
      dragGhostRef.current = null;
    }
  }, []);

  // Document-level mousemove/mouseup for DnD
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      if (!state.active) {
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (Math.abs(dx) + Math.abs(dy) <= 5) return;
        state.active = true;
        setIsDragging(true);
        setDragSourcePath(state.sourcePath);
        // Clear any text selection that started between mousedown and threshold
        window.getSelection()?.removeAllRanges();
        createDragGhost(state.sourceName, e.clientX, e.clientY);
      }
      // Prevent text selection — must preventDefault on EVERY mousemove, not just once
      e.preventDefault();
      // Move ghost
      const ghost = dragGhostRef.current;
      if (ghost) {
        ghost.style.left = `${e.clientX + 12}px`;
        ghost.style.top = `${e.clientY - 10}px`;
      }
      // Detect folder under cursor (ghost has pointer-events:none so elementFromPoint sees through it)
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const folderEl = el?.closest<HTMLElement>("[data-drop-path]");
      setDragOverPath(folderEl?.dataset.dropPath ?? null);

      // Feature 3: editor drop indicator bar for image files
      if (editor && isImageFile(state.sourcePath)) {
        const scrollEl = document.querySelector(".editor-area-scroll");
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

    const handleMouseUp = async (e: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;
      dragRef.current = null;
      removeDragGhost();
      hideDropIndicator();

      if (!state.active) {
        setIsDragging(false);
        setDragSourcePath(null);
        return; // Was a click, not a drag — let onClick handle it
      }

      // Suppress the click event that fires after mouseup
      suppressClickRef.current = true;
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);

      setIsDragging(false);
      setDragSourcePath(null);
      setDragOverPath(null);

      if (!rootPath) return;
      const sourcePath = state.sourcePath;

      // Feature 3: Drop image file onto editor — insert relative-path image
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const scrollEl = document.querySelector(".editor-area-scroll");
      const scrollRect = scrollEl?.getBoundingClientRect();
      const overEditor =
        scrollRect &&
        e.clientX >= scrollRect.left &&
        e.clientX <= scrollRect.right &&
        e.clientY >= scrollRect.top &&
        e.clientY <= scrollRect.bottom;
      if (overEditor && editor && isImageFile(sourcePath)) {
        const { activeTabId: tabId, tabs: currentTabs } =
          useEditorStore.getState();
        const tab = currentTabs.find((t) => t.id === tabId);
        if (tab?.filePath) {
          const fileDir = tab.filePath.substring(
            0,
            tab.filePath.lastIndexOf("/"),
          );
          const relativeSrc = getRelativePath(fileDir, sourcePath);
          const fileName = sourcePath.split("/").pop() ?? "";

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

      // Determine drop target folder
      const folderEl = el?.closest<HTMLElement>("[data-drop-path]");
      const targetPath = folderEl?.dataset.dropPath || rootPath;

      // Validation
      if (sourcePath === targetPath) return;
      if (targetPath !== rootPath && targetPath.startsWith(sourcePath + "/"))
        return;
      const sourceParent = sourcePath.substring(0, sourcePath.lastIndexOf("/"));
      if (sourceParent === targetPath) return;

      const parts = sourcePath.split("/");
      const fileName = parts[parts.length - 1];
      const newPath = targetPath + "/" + fileName;

      try {
        await renameFile(sourcePath, newPath);
        moveFileEntry(sourcePath, targetPath);
        const { tabs: currentTabs } = useEditorStore.getState();
        const openedTab = currentTabs.find((t) => t.filePath === sourcePath);
        if (openedTab) renameTab(sourcePath, newPath, fileName);
        useLinkStore.getState().invalidate();
      } catch (err) {
        logger.error("[FileTree] Move failed:", err);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      hideDropIndicator();
      removeDragGhost(); // cleanup on unmount
    };
  }, [
    rootPath,
    editor,
    moveFileEntry,
    renameTab,
    createDragGhost,
    removeDragGhost,
  ]);

  // Start drag from file items via mousedown on root (event delegation)
  const handleTreeMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't start drag when clicking inside rename input
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const fileEl = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-file-path]",
    );
    if (!fileEl?.dataset.filePath) return;
    const parts = fileEl.dataset.filePath.split("/");
    dragRef.current = {
      sourcePath: fileEl.dataset.filePath,
      sourceName: parts[parts.length - 1],
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
  }, []);

  // --- Context menu action dispatcher ---
  const handleContextMenuAction = useCallback(
    (action: string) => {
      if (!rootPath) return;
      const target = contextMenu;
      setContextMenu(null);
      if (!target) return;
      const parentPath = target.targetPath
        ? target.targetIsDir
          ? target.targetPath
          : target.targetPath.substring(0, target.targetPath.lastIndexOf("/"))
        : rootPath;
      switch (action) {
        case "delete":
          if (target.targetPath) handleDelete(target.targetPath);
          break;
        case "newFile":
          handleStartCreate(parentPath, false);
          break;
        case "newFolder":
          handleStartCreate(parentPath, true);
          break;
        case "rename":
          if (target.targetPath) setRenamingPath(target.targetPath);
          break;
      }
    },
    [contextMenu, rootPath, handleStartCreate, handleDelete],
  );

  if (!rootPath) {
    return (
      <div className="file-tree-empty">
        <p>No folder open</p>
        <button className="file-tree-open-btn" onClick={handleOpenFolder}>
          Open Folder
        </button>
      </div>
    );
  }

  return (
    <div
      className={`file-tree ${isDragging ? "file-tree-dragging" : ""}`}
      onContextMenu={handleEmptyAreaContextMenu}
      onKeyDown={handleTreeKeyDown}
      onMouseDown={handleTreeMouseDown}
      ref={treeRef}
      tabIndex={0}
    >
      <div className="file-tree-header">
        <input
          className="file-tree-search-input"
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setSearchQuery("");
              searchInputRef.current?.blur();
            }
            e.stopPropagation();
          }}
          placeholder="Filter files…"
          ref={searchInputRef}
          type="text"
          value={searchQuery}
        />
        <button
          className="file-tree-action-btn"
          onClick={() => handleStartCreate(rootPath, false)}
          title="New File"
        >
          <IconNewFile />
        </button>
        <button
          className="file-tree-action-btn"
          onClick={() => handleStartCreate(rootPath, true)}
          title="New Folder"
        >
          <IconNewFolder />
        </button>
      </div>
      {tagFilter && (
        <div className="filetree-tag-filter">
          <span className="filetree-tag-filter-label">
            Filter:{" "}
            <span className="filetree-tag-filter-tag">#{tagFilter}</span>
          </span>
          <button
            className="filetree-tag-filter-clear"
            onClick={() => setTagFilter(null)}
            title="Clear filter"
          >
            ×
          </button>
        </div>
      )}
      {searchResults ? (
        <div className="file-tree-results">
          {searchResults.map((file) => (
            <div
              className={`file-tree-item file-tree-file ${selectedPath === file.path ? "file-tree-item-active" : ""}`}
              key={file.path}
              onClick={() => {
                handleFileClick({
                  name: file.name,
                  path: file.path,
                  isDir: false,
                });
                setSearchQuery("");
              }}
              style={{ paddingLeft: "8px" }}
            >
              <span className="file-tree-icon">{getFileIcon(file.name)}</span>
              <span className="file-tree-name">
                {file.name}
                <span className="file-tree-result-path">
                  {file.relativePath}
                </span>
              </span>
            </div>
          ))}
          {searchResults.length === 0 && (
            <div
              className="file-tree-empty"
              style={{ height: "auto", padding: "16px 0" }}
            >
              No matching files
            </div>
          )}
        </div>
      ) : (
        <>
          {creatingEntry && creatingEntry.parentPath === rootPath && (
            <div className="file-tree-item" style={{ paddingLeft: "8px" }}>
              <span className="file-tree-icon">
                {creatingEntry.isDir ? <IconFolder /> : <IconFile />}
              </span>
              <input
                autoFocus
                className="file-tree-rename-input"
                onBlur={(e) => {
                  if (e.target.value.trim())
                    handleConfirmCreate(e.target.value);
                  else handleCancelCreate();
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleConfirmCreate((e.target as HTMLInputElement).value);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleCancelCreate();
                  }
                  e.stopPropagation();
                }}
                placeholder={creatingEntry.isDir ? "folder name" : "file name"}
              />
            </div>
          )}
          {(filteredPaths
            ? fileTree.filter((entry) =>
                entryMatchesTagFilter(entry, filteredPaths),
              )
            : fileTree
          ).map((entry) => (
            <FileTreeNode
              creatingEntry={creatingEntry}
              depth={0}
              dragOverPath={dragOverPath}
              dragSourcePath={dragSourcePath}
              entry={entry}
              expandedDirs={expandedDirs}
              key={entry.path}
              onCancelCreate={handleCancelCreate}
              onCancelRename={handleCancelRename}
              onConfirmCreate={handleConfirmCreate}
              onConfirmRename={handleConfirmRename}
              onContextMenu={handleContextMenu}
              onFileClick={handleFileClick}
              onStartRename={handleStartRename}
              onToggleDir={handleToggleDir}
              renamingPath={renamingPath}
              selectedPath={selectedPath}
            />
          ))}
        </>
      )}

      {contextMenu && (
        <div
          className="file-tree-context-menu"
          onClick={(e) => e.stopPropagation()}
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {(contextMenu.targetPath === null || contextMenu.targetIsDir) && (
            <>
              <div
                className="file-tree-context-menu-item"
                onClick={() => handleContextMenuAction("newFile")}
              >
                New File
              </div>
              <div
                className="file-tree-context-menu-item"
                onClick={() => handleContextMenuAction("newFolder")}
              >
                New Folder
              </div>
            </>
          )}
          {contextMenu.targetPath !== null && (
            <>
              {contextMenu.targetIsDir && (
                <div className="file-tree-context-menu-separator" />
              )}
              <div
                className="file-tree-context-menu-item"
                onClick={() => handleContextMenuAction("rename")}
              >
                Rename
              </div>
              <div
                className="file-tree-context-menu-item file-tree-context-menu-item-danger"
                onClick={() => handleContextMenuAction("delete")}
              >
                Delete
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- FileTreeNode ---
// Mouse-based DnD: files have data-file-path, folders have data-drop-path.
// All DnD logic is handled at the root FileTree level via document mouse events.
function FileTreeNode({
  entry,
  depth,
  expandedDirs,
  onToggleDir,
  onFileClick,
  selectedPath,
  renamingPath,
  onStartRename,
  onConfirmRename,
  onCancelRename,
  onContextMenu,
  creatingEntry,
  onConfirmCreate,
  onCancelCreate,
  dragOverPath,
  dragSourcePath,
}: {
  creatingEntry: CreatingEntryState | null;
  depth: number;
  dragOverPath: null | string;
  dragSourcePath: null | string;
  entry: FileEntry;
  expandedDirs: Set<string>;
  onCancelCreate: () => void;
  onCancelRename: () => void;
  onConfirmCreate: (name: string) => void;
  onConfirmRename: (oldPath: string, newName: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onFileClick: (entry: FileEntry) => void;
  onStartRename: (path: string) => void;
  onToggleDir: (path: string) => void;
  renamingPath: null | string;
  selectedPath: null | string;
}) {
  const paddingLeft = `${depth * 16 + 8}px`;
  const isExpanded = expandedDirs.has(entry.path);
  const isRenaming = renamingPath === entry.path;
  const isSelected = selectedPath === entry.path;
  const isDragOver = dragOverPath === entry.path;
  const isDragSource = dragSourcePath === entry.path;
  const inputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      const name = entry.name;
      const dotIdx = name.lastIndexOf(".");
      inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : name.length);
    }
  }, [isRenaming, entry.name]);

  const showCreateInput =
    creatingEntry && creatingEntry.parentPath === entry.path;
  useEffect(() => {
    if (showCreateInput && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [showCreateInput]);

  if (entry.isDir) {
    return (
      <div
        className={isDragOver ? "file-tree-drop-target" : ""}
        data-drop-path={entry.path}
      >
        <div
          className="file-tree-item file-tree-dir"
          onClick={() => onToggleDir(entry.path)}
          onContextMenu={(e) => onContextMenu(e, entry.path, true)}
          style={{ paddingLeft }}
        >
          <span
            className={`file-tree-icon file-tree-chevron ${isExpanded ? "file-tree-chevron-open" : ""}`}
          >
            {"\u25B6"}
          </span>
          <span className="file-tree-icon">
            <IconFolder />
          </span>
          {isRenaming ? (
            <input
              className="file-tree-rename-input"
              defaultValue={entry.name}
              onBlur={(e) => onConfirmRename(entry.path, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onConfirmRename(
                    entry.path,
                    (e.target as HTMLInputElement).value,
                  );
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onCancelRename();
                }
                e.stopPropagation();
              }}
              ref={inputRef}
            />
          ) : (
            <span
              className="file-tree-name"
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartRename(entry.path);
              }}
            >
              {entry.name}
            </span>
          )}
        </div>
        {isExpanded && (
          <>
            {showCreateInput && (
              <div
                className="file-tree-item"
                style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              >
                <span className="file-tree-icon">
                  {creatingEntry!.isDir ? <IconFolder /> : <IconFile />}
                </span>
                <input
                  className="file-tree-rename-input"
                  onBlur={(e) => {
                    if (e.target.value.trim()) {
                      onConfirmCreate(e.target.value);
                    } else {
                      onCancelCreate();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onConfirmCreate((e.target as HTMLInputElement).value);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      onCancelCreate();
                    }
                    e.stopPropagation();
                  }}
                  placeholder={
                    creatingEntry!.isDir ? "folder name" : "file name"
                  }
                  ref={createInputRef}
                />
              </div>
            )}
            {entry.children?.map((child) => (
              <FileTreeNode
                creatingEntry={creatingEntry}
                depth={depth + 1}
                dragOverPath={dragOverPath}
                dragSourcePath={dragSourcePath}
                entry={child}
                expandedDirs={expandedDirs}
                key={child.path}
                onCancelCreate={onCancelCreate}
                onCancelRename={onCancelRename}
                onConfirmCreate={onConfirmCreate}
                onConfirmRename={onConfirmRename}
                onContextMenu={onContextMenu}
                onFileClick={onFileClick}
                onStartRename={onStartRename}
                onToggleDir={onToggleDir}
                renamingPath={renamingPath}
                selectedPath={selectedPath}
              />
            ))}
          </>
        )}
      </div>
    );
  }

  // File item — drag source (detected by data-file-path via mouse events at root)
  return (
    <div
      className={`file-tree-item file-tree-file ${isSelected ? "file-tree-item-active" : ""} ${isDragSource ? "file-tree-drag-source" : ""}`}
      data-file-path={entry.path}
      onClick={() => !isRenaming && onFileClick(entry)}
      onContextMenu={(e) => onContextMenu(e, entry.path, false)}
      style={{ paddingLeft }}
    >
      <span className="file-tree-icon">{getFileIcon(entry.name)}</span>
      {isRenaming ? (
        <input
          className="file-tree-rename-input"
          defaultValue={entry.name}
          onBlur={(e) => onConfirmRename(entry.path, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onConfirmRename(entry.path, (e.target as HTMLInputElement).value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancelRename();
            }
            e.stopPropagation();
          }}
          ref={inputRef}
        />
      ) : (
        <span
          className="file-tree-name"
          onDoubleClick={(e) => {
            e.stopPropagation();
            onStartRename(entry.path);
          }}
        >
          {entry.name}
        </span>
      )}
    </div>
  );
}

function getFileIcon(name: string) {
  const ext = name.includes(".")
    ? name.split(".").pop()?.toLowerCase() || ""
    : "";
  switch (ext) {
    case "bash":
    case "sh":
    case "zsh":
      return <IconFile color="#89e051" label="$" />;
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return <IconFile color="#e8d44d" label="JS" />;
    case "css":
    case "less":
    case "scss":
      return <IconFile color="#56b6c2" label="#" />;
    case "gif":
    case "ico":
    case "jpeg":
    case "jpg":
    case "png":
    case "svg":
    case "webp":
      return <IconFile color="#a074c4" label="img" />;
    case "go":
      return <IconFile color="#00add8" label="GO" />;
    case "htm":
    case "html":
      return <IconFile color="#e37933" label="&lt;&gt;" />;
    case "json":
      return <IconFile color="#cbcb41" label="{}" />;
    case "md":
    case "mdx":
      return <IconFile color="#519aba" label="M" />;
    case "py":
      return <IconFile color="#3572a5" label="PY" />;
    case "rs":
      return <IconFile color="#dea584" label="RS" />;
    case "toml":
      return <IconFile color="#9c4221" label="T" />;
    case "ts":
    case "tsx":
      return <IconFile color="#3178c6" label="TS" />;
    case "yaml":
    case "yml":
      return <IconFile color="#cb171e" label="Y" />;
    default:
      return <IconFile />;
  }
}

function IconFile({ label, color }: { color?: string; label?: string }) {
  const props = color ? { ...S, stroke: color } : S;
  return (
    <svg {...props}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      {label && (
        <text
          fill={color ?? "currentColor"}
          fontFamily="system-ui,sans-serif"
          fontSize="8"
          fontWeight="700"
          stroke="none"
          textAnchor="middle"
          x="12"
          y="19"
        >
          {label}
        </text>
      )}
    </svg>
  );
}

function IconFolder() {
  return (
    <svg {...S}>
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

function IconNewFile() {
  return (
    <svg {...S}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" x2="12" y1="18" y2="12" />
      <line x1="9" x2="15" y1="15" y2="15" />
    </svg>
  );
}

function IconNewFolder() {
  return (
    <svg {...S}>
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      <line x1="12" x2="12" y1="11" y2="17" />
      <line x1="9" x2="15" y1="14" y2="14" />
    </svg>
  );
}

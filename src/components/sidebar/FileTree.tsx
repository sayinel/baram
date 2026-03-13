// §4.3 File tree sidebar — directory browsing + file opening
// §33 Inline rename with wikilink auto-update
// File management: context menu, inline creation, delete, drag-and-drop
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { ContextMenuState } from "./file-tree-types";
import type { FileTreeContextValue } from "./FileTreeContext";
import type { Editor } from "@tiptap/react";

import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import {
  type FileEntry,
  openFolder,
  useFileStore,
} from "../../stores/file-store";
import { logger } from "../../utils/logger";
import { getFileIcon } from "./file-icon";
import {
  IconFile,
  IconFolder,
  IconNewFile,
  IconNewFolder,
} from "./file-tree-icons";
import { DRAG_EXPAND_DELAY_MS, TREE_BASE_PADDING_PX } from "./file-tree-types";
import { FileTreeProvider } from "./FileTreeContext";
import { FileTreeNode } from "./FileTreeNode";
import { useFileTreeCrud } from "./hooks/use-file-tree-crud";
import { useFileTreeDnD } from "./hooks/use-file-tree-dnd";
import { useFileTreeRename } from "./hooks/use-file-tree-rename";
import { useFileTreeSearch } from "./hooks/use-file-tree-search";

export function FileTree({
  editor,
}: {
  editor?: Editor | null;
}): React.JSX.Element {
  const { fileTree, rootPath, setFileContent } = useFileStore();
  const tagFilter = useFileStore((s) => s.tagFilter);
  const setTagFilter = useFileStore((s) => s.setTagFilter);
  const expandedDirs = useFileStore((s) => s.expandedDirs);
  const toggleExpandedDir = useFileStore((s) => s.toggleExpandedDir);
  const expandDir = useFileStore((s) => s.expandDir);
  const { openTab, tabs, activeTabId } = useEditorStore();
  const [selectedPath, setSelectedPath] = useState<null | string>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // --- Hooks ---
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    filteredPaths,
    entryMatchesTagFilter,
  } = useFileTreeSearch();

  const {
    renamingPath,
    setRenamingPath,
    handleStartRename,
    handleCancelRename,
    handleConfirmRename,
  } = useFileTreeRename(treeRef);

  const {
    creatingEntry,
    handleStartCreate,
    handleConfirmCreate,
    handleCancelCreate,
    handleDelete,
  } = useFileTreeCrud();

  const {
    dragOverPath,
    dragSourcePath,
    isDragging,
    handleTreeMouseDown,
    suppressClickRef,
  } = useFileTreeDnD(editor);

  // --- Sync selectedPath with active tab ---
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeFilePath = activeTab?.filePath ?? null;
  useEffect(() => {
    if (activeFilePath) setSelectedPath(activeFilePath);
  }, [activeFilePath]);

  // --- Close context menu on click outside or Escape ---
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (): void => setContextMenu(null);
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // --- Auto-expand folders after hover during drag ---
  useEffect(() => {
    if (!dragOverPath) return;
    const timer = setTimeout(() => {
      expandDir(dragOverPath);
    }, DRAG_EXPAND_DELAY_MS);
    return () => clearTimeout(timer);
  }, [dragOverPath, expandDir]);

  // --- Keyboard shortcuts ---
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
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

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    const selected = await open({ directory: true });
    if (selected) await openFolder(selected);
  }, []);

  const handleToggleDir = useCallback(
    (path: string): void => {
      toggleExpandedDir(path);
    },
    [toggleExpandedDir],
  );

  const handleFileClick = useCallback(
    async (entry: FileEntry): Promise<void> => {
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
    [tabs, setFileContent, openTab, suppressClickRef],
  );

  // --- Context menu ---
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isDir: boolean): void => {
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

  const handleEmptyAreaContextMenu = useCallback(
    (e: React.MouseEvent): void => {
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
    },
    [],
  );

  const handleContextMenuAction = useCallback(
    (action: string): void => {
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
    [contextMenu, rootPath, handleStartCreate, handleDelete, setRenamingPath],
  );

  // --- Context value (memoized to avoid unnecessary re-renders) ---
  const ctxValue = useMemo(
    (): FileTreeContextValue => ({
      selectedPath,
      renamingPath,
      creatingEntry,
      expandedDirs,
      dragOverPath,
      dragSourcePath,
    }),
    [
      selectedPath,
      renamingPath,
      creatingEntry,
      expandedDirs,
      dragOverPath,
      dragSourcePath,
    ],
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
    <FileTreeProvider value={ctxValue}>
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
                style={{ paddingLeft: `${TREE_BASE_PADDING_PX}px` }}
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
              <div
                className="file-tree-item"
                style={{ paddingLeft: `${TREE_BASE_PADDING_PX}px` }}
              >
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
                  placeholder={
                    creatingEntry.isDir ? "folder name" : "file name"
                  }
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
                depth={0}
                entry={entry}
                key={entry.path}
                onCancelCreate={handleCancelCreate}
                onCancelRename={handleCancelRename}
                onConfirmCreate={handleConfirmCreate}
                onConfirmRename={handleConfirmRename}
                onContextMenu={handleContextMenu}
                onFileClick={handleFileClick}
                onStartRename={handleStartRename}
                onToggleDir={handleToggleDir}
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
    </FileTreeProvider>
  );
}

// §4.3 File tree sidebar — directory browsing + file opening
// §33 Inline rename with wikilink auto-update
// File management: context menu, inline creation, delete, drag-and-drop
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { ContextMenuState } from "./file-tree-types";
import type { FileTreeContextValue } from "./FileTreeContext";

import { useShallow } from "zustand/shallow";

import { useEditorContext } from "../../contexts/editor-context";
import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import {
  type FileEntry,
  openFolder,
  useFileStore,
} from "../../stores/file/file";
import { isPdfFile } from "../../utils/file-type";
import { logger } from "../../utils/logger";
import { getFileIcon } from "./file-icon";
import { FileTreeContextMenu } from "./file-tree-context-menu";
import {
  IconCollapseAll,
  IconExpandAll,
  IconFile,
  IconFolder,
  IconNewFile,
  IconNewFolder,
} from "./file-tree-icons";
import { someSelectedIsDir } from "./file-tree-multi-ops";
import { ancestorDirs } from "./file-tree-reveal";
import { DRAG_EXPAND_DELAY_MS, TREE_BASE_PADDING_PX } from "./file-tree-types";
import { computeVisibleEntries } from "./file-tree-visible";
import { FileTreeProvider } from "./FileTreeContext";
import { FileTreeNode } from "./FileTreeNode";
import { FileTreeSortDropdown } from "./FileTreeSortDropdown";
import { FolderAccessError } from "./FolderAccessError";
import { useFileTreeActions } from "./hooks/use-file-tree-actions";
import { useFileTreeCrud } from "./hooks/use-file-tree-crud";
import { useFileTreeDnD } from "./hooks/use-file-tree-dnd";
import { useFileTreeKeyboard } from "./hooks/use-file-tree-keyboard";
import { useFileTreeRename } from "./hooks/use-file-tree-rename";
import { useFileTreeSearch } from "./hooks/use-file-tree-search";
import { useFileTreeSelection } from "./hooks/use-file-tree-selection";
import { useGitBadges } from "./hooks/use-git-badges";
import { MoveToFolderModal } from "./MoveToFolderModal";

export function FileTree(): React.JSX.Element {
  const editor = useEditorContext();
  const {
    collapseAllDirs,
    expandAllDirs,
    fileTree,
    fileTreeSortOrder,
    loadError,
    retryLoadFileTree,
    rootPath,
    setFileContent,
    setFileTreeSortOrder,
  } = useFileStore(
    useShallow((s) => ({
      collapseAllDirs: s.collapseAllDirs,
      expandAllDirs: s.expandAllDirs,
      fileTree: s.fileTree,
      fileTreeSortOrder: s.fileTreeSortOrder,
      loadError: s.loadError,
      retryLoadFileTree: s.retryLoadFileTree,
      rootPath: s.rootPath,
      setFileContent: s.setFileContent,
      setFileTreeSortOrder: s.setFileTreeSortOrder,
    })),
  );
  const tagFilter = useFileStore((s) => s.tagFilter);
  const setTagFilter = useFileStore((s) => s.setTagFilter);
  const expandedDirs = useFileStore((s) => s.expandedDirs);
  const toggleExpandedDir = useFileStore((s) => s.toggleExpandedDir);
  const expandDir = useFileStore((s) => s.expandDir);
  const { openTab, tabs, activeTabId } = useEditorStore(
    useShallow((s) => ({
      openTab: s.openTab,
      tabs: s.tabs,
      activeTabId: s.activeTabId,
    })),
  );
  const { selectedPaths, selectSingle, toggleSelect, selectRange } =
    useFileTreeSelection();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [moveModalSources, setMoveModalSources] = useState<null | string[]>(
    null,
  );
  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // §4.4 Roving-tabindex bookkeeping (focusedPath state) happens on every
  // active-tab change; imperatively stealing real DOM focus must only
  // happen when the change originated from keyboard nav, not tab-sync.
  const shouldStealFocusRef = useRef(false);

  // --- Hooks ---
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    filteredPaths,
    entryMatchesTagFilter,
  } = useFileTreeSearch();

  const visibleEntries = useMemo(
    () =>
      computeVisibleEntries(
        fileTree,
        expandedDirs,
        filteredPaths,
        entryMatchesTagFilter,
      ).map((e) => ({ path: e.path, isDir: e.isDir })),
    [fileTree, expandedDirs, filteredPaths, entryMatchesTagFilter],
  );
  const visiblePaths = useMemo(
    () => visibleEntries.map((e) => e.path),
    [visibleEntries],
  );
  // 단일 선택일 때만 유효한 대상 (F2 rename 등 단일 작업용)
  const primaryPath = selectedPaths.size === 1 ? [...selectedPaths][0] : null;

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
    handleDeleteMany,
  } = useFileTreeCrud();

  const {
    dragOverPath,
    dragSourcePaths,
    isDragging,
    handleTreeMouseDown,
    suppressClickRef,
  } = useFileTreeDnD(editor, selectedPaths);

  const actions = useFileTreeActions();
  const gitBadges = useGitBadges(rootPath);

  const { focusedPath, setFocusedPath, handleNavKeyDown } = useFileTreeKeyboard(
    {
      navEntries: visibleEntries,
      visiblePaths,
      rootPath: rootPath ?? "",
      expandedDirs,
      expandDir,
      toggleExpandedDir,
      selectSingle,
      selectRange,
      onOpenFile: (path) => {
        void actions.openInNewTab(path);
      },
    },
  );

  // --- Sync selectedPaths with active tab ---
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeFilePath = activeTab?.filePath ?? null;
  // §4.5 This effect must react ONLY to tab switches, not filter keystrokes:
  // read the filter state non-reactively (ref + getState()) so searchQuery
  // and tagFilter changes don't re-run it and collapse a multi-selection /
  // steal keyboard focus back to the active file on every keystroke.
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  useEffect(() => {
    if (!activeFilePath) return;
    shouldStealFocusRef.current = false;
    const filterActive =
      searchQueryRef.current.trim() !== "" ||
      useFileStore.getState().tagFilter !== null;
    if (!filterActive && rootPath) {
      // auto-reveal: expand ancestor dirs so the row renders and can scroll in
      for (const dir of ancestorDirs(activeFilePath, rootPath)) {
        expandDir(dir);
      }
    }
    selectSingle(activeFilePath);
    setFocusedPath(activeFilePath);
  }, [activeFilePath, rootPath, expandDir, selectSingle, setFocusedPath]);

  // --- Scroll focused row into view + roving focus ---
  useEffect(() => {
    if (!focusedPath || !treeRef.current) return;
    const el = treeRef.current.querySelector<HTMLElement>(
      `[data-tree-path="${CSS.escape(focusedPath)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
    if (shouldStealFocusRef.current) {
      el?.focus();
      shouldStealFocusRef.current = false;
    }
  }, [focusedPath]);

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
      // 인라인 입력(검색/rename)에 포커스가 있으면 트리 내비 무시
      const tag = (e.target as HTMLElement).tagName;
      // MoveToFolderModal (portal) keydown bubbles through the React tree to
      // here; its input doesn't stopPropagation, so this guard is the defense
      // that stops modal ArrowDown/Enter from driving tree nav. Do NOT remove.
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "F2" && primaryPath && !renamingPath) {
        e.preventDefault();
        setRenamingPath(primaryPath);
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedPaths.size > 0 &&
        !renamingPath &&
        e.metaKey
      ) {
        e.preventDefault();
        handleDeleteMany([...selectedPaths]);
        return;
      }
      if (!renamingPath) {
        if (e.key.startsWith("Arrow")) shouldStealFocusRef.current = true;
        handleNavKeyDown(e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primaryPath, renamingPath, selectedPaths, handleNavKeyDown],
  );

  const handleOpenFolder = useCallback(async (): Promise<void> => {
    const selected = await open({ directory: true });
    if (selected) await openFolder(selected);
  }, []);

  const handleDirClick = useCallback(
    (entry: FileEntry, e: React.MouseEvent): void => {
      if (suppressClickRef.current) return;
      treeRef.current?.focus();
      setFocusedPath(entry.path);
      if (e.shiftKey) {
        selectRange(entry.path, visiblePaths);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        toggleSelect(entry.path);
        return;
      }
      selectSingle(entry.path);
      toggleExpandedDir(entry.path);
    },
    [
      toggleExpandedDir,
      selectRange,
      selectSingle,
      toggleSelect,
      visiblePaths,
      suppressClickRef,
      setFocusedPath,
    ],
  );

  const handleFileClick = useCallback(
    async (entry: FileEntry, e: React.MouseEvent): Promise<void> => {
      if (suppressClickRef.current) return;
      treeRef.current?.focus();
      setFocusedPath(entry.path);
      if (e.shiftKey) {
        selectRange(entry.path, visiblePaths);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        toggleSelect(entry.path);
        return;
      }
      selectSingle(entry.path);
      const existing = tabs.find((t) => t.filePath === entry.path);
      if (existing) {
        useEditorStore.getState().setActiveTab(existing.id);
        return;
      }
      try {
        // PDFs are binary — never read through the UTF-8 IPC; the viewer
        // loads them via the asset: protocol. Cache "" so tab switching
        // treats the tab as loaded.
        const content = isPdfFile(entry.path) ? "" : await readFile(entry.path);
        setFileContent(entry.path, content);
        openTab({
          contextId: "",
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
    [
      tabs,
      setFileContent,
      openTab,
      suppressClickRef,
      selectRange,
      selectSingle,
      toggleSelect,
      visiblePaths,
      setFocusedPath,
    ],
  );

  // --- Context menu ---
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isDir: boolean): void => {
      e.preventDefault();
      e.stopPropagation();
      let count = 1;
      let hasDir = isDir;
      if (selectedPaths.has(path) && selectedPaths.size > 1) {
        count = selectedPaths.size;
        hasDir = someSelectedIsDir(fileTree, selectedPaths);
      } else {
        selectSingle(path);
      }
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        targetPath: path,
        targetIsDir: isDir,
        selectionCount: count,
        selectionHasDir: hasDir,
      });
    },
    [selectedPaths, selectSingle, fileTree],
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
          selectionCount: 1,
          selectionHasDir: false,
        });
      }
    },
    [],
  );

  const handleContextMenuAction = useCallback(
    async (action: string): Promise<void> => {
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
        case "copyPath":
          if (target.selectionCount > 1)
            actions.copyPath([...selectedPaths].join("\n"));
          else if (target.targetPath) actions.copyPath(target.targetPath);
          break;
        case "copyRelativePath":
          if (target.targetPath) actions.copyRelativePath(target.targetPath);
          break;
        case "copyWikilink":
          if (target.targetPath) actions.copyWikilink(target.targetPath);
          break;
        case "delete":
          if (target.selectionCount > 1) handleDeleteMany([...selectedPaths]);
          else if (target.targetPath) handleDelete(target.targetPath);
          break;
        case "duplicate":
          if (target.selectionCount > 1) {
            // 폴더 포함 시 전체 중단 (메뉴 비활성과 이중 방어)
            if (target.selectionHasDir) break;
            for (const p of [...selectedPaths]) {
              await actions.duplicateFile(p);
            }
          } else if (target.targetPath && !target.targetIsDir) {
            actions.duplicateFile(target.targetPath);
          }
          break;
        case "export":
          if (target.targetPath && !target.targetIsDir)
            actions.exportFile(target.targetPath);
          break;
        case "move":
          if (target.selectionCount > 1)
            setMoveModalSources([...selectedPaths]);
          else if (target.targetPath) setMoveModalSources([target.targetPath]);
          break;
        case "newFile":
          handleStartCreate(parentPath, false);
          break;
        case "newFolder":
          handleStartCreate(parentPath, true);
          break;
        case "openInNewTab":
          if (target.targetPath && !target.targetIsDir)
            actions.openInNewTab(target.targetPath);
          break;
        case "rename":
          if (target.targetPath) setRenamingPath(target.targetPath);
          break;
        case "reveal":
          if (target.targetPath) actions.revealInFileManager(target.targetPath);
          break;
        case "versionHistory":
          if (target.targetPath) actions.showVersionHistory(target.targetPath);
          break;
      }
    },
    [
      contextMenu,
      rootPath,
      handleStartCreate,
      handleDelete,
      handleDeleteMany,
      setRenamingPath,
      actions,
      selectedPaths,
    ],
  );

  // --- Context value (memoized to avoid unnecessary re-renders) ---
  const ctxValue = useMemo(
    (): FileTreeContextValue => ({
      selectedPaths,
      renamingPath,
      creatingEntry,
      expandedDirs,
      dragOverPath,
      dragSourcePaths,
      focusedPath,
      gitBadges,
    }),
    [
      selectedPaths,
      renamingPath,
      creatingEntry,
      expandedDirs,
      dragOverPath,
      dragSourcePaths,
      focusedPath,
      gitBadges,
    ],
  );

  if (loadError) {
    return (
      <FolderAccessError loadError={loadError} onRetry={retryLoadFileTree} />
    );
  }

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
          <FileTreeSortDropdown
            onChange={setFileTreeSortOrder}
            value={fileTreeSortOrder}
          />
          {expandedDirs.size > 0 ? (
            <button
              className="file-tree-action-btn"
              onClick={collapseAllDirs}
              title="Collapse all"
              type="button"
            >
              <IconCollapseAll />
            </button>
          ) : (
            <button
              className="file-tree-action-btn"
              onClick={expandAllDirs}
              title="Expand all"
              type="button"
            >
              <IconExpandAll />
            </button>
          )}
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
                className={`file-tree-item file-tree-file ${selectedPaths.has(file.path) ? "file-tree-item-active" : ""}`}
                key={file.path}
                onClick={(e) => {
                  handleFileClick(
                    { name: file.name, path: file.path, isDir: false },
                    e,
                  );
                  setSearchQuery("");
                }}
                style={{ paddingLeft: `${TREE_BASE_PADDING_PX}px` }}
              >
                <span className="file-tree-icon">{getFileIcon(file.name)}</span>
                <span className="file-tree-name text-truncate">
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
            <div aria-label="File tree" aria-multiselectable="true" role="tree">
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
                  onDirClick={handleDirClick}
                  onFileClick={handleFileClick}
                  onStartRename={handleStartRename}
                />
              ))}
            </div>
          </>
        )}

        {contextMenu && (
          <FileTreeContextMenu
            menu={contextMenu}
            onAction={handleContextMenuAction}
          />
        )}
        {moveModalSources && (
          <MoveToFolderModal
            onClose={() => setMoveModalSources(null)}
            sources={moveModalSources}
          />
        )}
      </div>
    </FileTreeProvider>
  );
}

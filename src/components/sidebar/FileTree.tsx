// §4.3 File tree sidebar — directory browsing + file opening
// §33 Inline rename with wikilink auto-update
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useFileStore, openFolder, type FileEntry } from "../../stores/file-store";
import { useEditorStore } from "../../stores/editor-store";
import { useLinkStore } from "../../stores/link-store";
import { readFile, renameFileWithLinks } from "../../ipc/invoke";
import { flattenFileTree, fuzzyMatch, fuzzyScore, isGlobPattern, globMatch } from "../../utils/file-search";

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
}: {
  entry: FileEntry;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFileClick: (entry: FileEntry) => void;
  selectedPath: string | null;
  renamingPath: string | null;
  onStartRename: (path: string) => void;
  onConfirmRename: (oldPath: string, newName: string) => void;
  onCancelRename: () => void;
}) {
  const paddingLeft = `${depth * 16 + 8}px`;
  const isExpanded = expandedDirs.has(entry.path);
  const isRenaming = renamingPath === entry.path;
  const isSelected = selectedPath === entry.path;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      // Select filename without extension
      const name = entry.name;
      const dotIdx = name.lastIndexOf(".");
      inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : name.length);
    }
  }, [isRenaming, entry.name]);

  if (entry.isDir) {
    return (
      <div>
        <div
          className="file-tree-item file-tree-dir"
          style={{ paddingLeft }}
          onClick={() => onToggleDir(entry.path)}
        >
          <span className={`file-tree-icon file-tree-chevron ${isExpanded ? "file-tree-chevron-open" : ""}`}>
            {"\u25B6"}
          </span>
          <span className="file-tree-name">{entry.name}</span>
        </div>
        {isExpanded &&
          entry.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onFileClick={onFileClick}
              selectedPath={selectedPath}
              renamingPath={renamingPath}
              onStartRename={onStartRename}
              onConfirmRename={onConfirmRename}
              onCancelRename={onCancelRename}
            />
          ))}
      </div>
    );
  }

  return (
    <div
      className={`file-tree-item file-tree-file ${isSelected ? "file-tree-item-active" : ""}`}
      style={{ paddingLeft }}
      onClick={() => !isRenaming && onFileClick(entry)}
    >
      <span className="file-tree-icon">{"\uD83D\uDCC4"}</span>
      {isRenaming ? (
        <input
          ref={inputRef}
          className="file-tree-rename-input"
          defaultValue={entry.name}
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
          onBlur={(e) => onConfirmRename(entry.path, e.target.value)}
          onClick={(e) => e.stopPropagation()}
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

export function FileTree() {
  const { fileTree, rootPath, setFileContent, renameFileEntry } = useFileStore();
  const { openTab, tabs, activeTabId, renameTab } = useEditorStore();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const treeRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q || !rootPath) return null;
    const flat = flattenFileTree(fileTree, rootPath);
    if (isGlobPattern(q)) {
      // Glob: match against relativePath (supports "docs/*.md"), fall back to name
      return flat.filter((f) => globMatch(q, f.name) || globMatch(q, f.relativePath));
    }
    return flat
      .filter((f) => fuzzyMatch(q, f.name))
      .sort((a, b) => fuzzyScore(q, a.name) - fuzzyScore(q, b.name));
  }, [searchQuery, fileTree, rootPath]);

  // Sync selectedPath with active tab
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeFilePath = activeTab?.filePath ?? null;
  useEffect(() => {
    if (activeFilePath) {
      setSelectedPath(activeFilePath);
    }
  }, [activeFilePath]);

  // Global F2 handler: listen on the tree container
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "F2" && selectedPath && !renamingPath) {
        e.preventDefault();
        setRenamingPath(selectedPath);
      }
    },
    [selectedPath, renamingPath],
  );

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true });
    if (selected) {
      await openFolder(selected);
    }
  }, []);

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileClick = useCallback(
    async (entry: FileEntry) => {
      // Always select in tree + keep focus on tree
      setSelectedPath(entry.path);
      treeRef.current?.focus();

      // Check if already open
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
        console.error("[FileTree] Failed to read file:", err);
      }
    },
    [tabs, setFileContent, openTab],
  );

  const handleStartRename = useCallback((path: string) => {
    setRenamingPath(path);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingPath(null);
    treeRef.current?.focus();
  }, []);

  const handleConfirmRename = useCallback(
    async (oldPath: string, newName: string) => {
      setRenamingPath(null);
      treeRef.current?.focus();

      // Extract old name from path
      const parts = oldPath.split("/");
      const oldName = parts[parts.length - 1];

      // No change
      if (newName === oldName || !newName.trim()) return;

      const newPath = oldPath.substring(0, oldPath.length - oldName.length) + newName;

      try {
        // IPC: rename file + update wikilinks in vault
        const result = await renameFileWithLinks(oldPath, newPath);

        // Update file tree
        renameFileEntry(oldPath, newPath, newName);

        // Update tab if open
        renameTab(oldPath, newPath, newName);

        // Track selection to the new path
        setSelectedPath(newPath);

        // Update openFiles cache for the renamed file
        const { openFiles } = useFileStore.getState();
        if (openFiles.has(oldPath)) {
          const content = openFiles.get(oldPath)!;
          useFileStore.getState().removeFileContent(oldPath);
          useFileStore.getState().setFileContent(newPath, content);
        }

        // Reload content for files whose wikilinks were updated
        for (const updatedFile of result.updatedFiles) {
          if (openFiles.has(updatedFile)) {
            try {
              const newContent = await readFile(updatedFile);
              useFileStore.getState().setFileContent(updatedFile, newContent);
            } catch {
              // ignore read errors for updated files
            }
          }
        }

        // Invalidate backlink index
        useLinkStore.getState().invalidate();
      } catch (err) {
        console.error("[FileTree] Rename failed:", err);
      }
    },
    [renameFileEntry, renameTab],
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
      ref={treeRef}
      className="file-tree"
      tabIndex={0}
      onKeyDown={handleTreeKeyDown}
    >
      <div className="file-tree-search">
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Filter files…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setSearchQuery("");
              searchInputRef.current?.blur();
            }
            e.stopPropagation();
          }}
        />
      </div>
      {searchResults ? (
        <div className="file-tree-results">
          {searchResults.map((file) => (
            <div
              key={file.path}
              className={`file-tree-item file-tree-file ${selectedPath === file.path ? "file-tree-item-active" : ""}`}
              style={{ paddingLeft: "8px" }}
              onClick={() => {
                handleFileClick({ name: file.name, path: file.path, isDir: false });
                setSearchQuery("");
              }}
            >
              <span className="file-tree-icon">{"\uD83D\uDCC4"}</span>
              <span className="file-tree-name">
                {file.name}
                <span className="file-tree-result-path">{file.relativePath}</span>
              </span>
            </div>
          ))}
          {searchResults.length === 0 && (
            <div className="file-tree-empty" style={{ height: "auto", padding: "16px 0" }}>
              No matching files
            </div>
          )}
        </div>
      ) : (
        fileTree.map((entry) => (
          <FileTreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            expandedDirs={expandedDirs}
            onToggleDir={handleToggleDir}
            onFileClick={handleFileClick}
            selectedPath={selectedPath}
            renamingPath={renamingPath}
            onStartRename={handleStartRename}
            onConfirmRename={handleConfirmRename}
            onCancelRename={handleCancelRename}
          />
        ))
      )}
    </div>
  );
}

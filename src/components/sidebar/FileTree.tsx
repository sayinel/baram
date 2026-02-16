// §4.3 File tree sidebar — directory browsing + file opening
import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useFileStore, openFolder, type FileEntry } from "../../stores/file-store";
import { useEditorStore } from "../../stores/editor-store";
import { readFile } from "../../ipc/invoke";

function FileTreeNode({
  entry,
  depth,
  expandedDirs,
  onToggleDir,
  onFileClick,
  activeFilePath,
}: {
  entry: FileEntry;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFileClick: (entry: FileEntry) => void;
  activeFilePath: string | null;
}) {
  const paddingLeft = `${depth * 16 + 8}px`;
  const isExpanded = expandedDirs.has(entry.path);

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
              activeFilePath={activeFilePath}
            />
          ))}
      </div>
    );
  }

  const isActive = entry.path === activeFilePath;

  return (
    <div
      className={`file-tree-item file-tree-file ${isActive ? "file-tree-item-active" : ""}`}
      style={{ paddingLeft }}
      onClick={() => onFileClick(entry)}
    >
      <span className="file-tree-icon">{"\uD83D\uDCC4"}</span>
      <span className="file-tree-name">{entry.name}</span>
    </div>
  );
}

export function FileTree() {
  const { fileTree, rootPath, setFileContent } = useFileStore();
  const { openTab, tabs, activeTabId } = useEditorStore();
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeFilePath = activeTab?.filePath ?? null;

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
        });
      } catch (err) {
        console.error("[FileTree] Failed to read file:", err);
      }
    },
    [tabs, setFileContent, openTab],
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
    <div className="file-tree">
      {fileTree.map((entry) => (
        <FileTreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          expandedDirs={expandedDirs}
          onToggleDir={handleToggleDir}
          onFileClick={handleFileClick}
          activeFilePath={activeFilePath}
        />
      ))}
    </div>
  );
}

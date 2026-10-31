// §4.3 File tree — recursive tree node component
// Reads 8 shared states from FileTreeContext; receives only 10 handler props. §395 — what a plugin's
// decoration changes is drawn by `FileTreeRowBody`, which subscribes to its own path; this row does not
// read the decoration store, so a decoration never re-renders a folder's mounted children (spec 0074 D9).
import { useEffect, useRef } from "react";

import type { FileEntry } from "../../stores/file/file";
import type { GitDot } from "./file-tree-row-body";
import type { CreatingEntryState } from "./file-tree-types";

import { ChevronRight } from "lucide-react";

import { toBadgeKey } from "../../stores/system/git-badges";
import { IconFile, IconFolder } from "./file-tree-icons";
import { FileTreeRowBody, RenameInput } from "./file-tree-row-body";
import { treeIndent } from "./file-tree-types";
import { useFileTreeContext } from "./FileTreeContext";

// --- FileTreeNode ---
export function FileTreeNode({
  entry,
  depth,
  onDirClick,
  onFileClick,
  onContextMenu,
  onStartRename,
  onConfirmRename,
  onCancelRename,
  onConfirmCreate,
  onCancelCreate,
}: {
  depth: number;
  entry: FileEntry;
  onCancelCreate: () => void;
  onCancelRename: () => void;
  onConfirmCreate: (name: string) => void;
  onConfirmRename: (oldPath: string, newName: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onDirClick: (entry: FileEntry, e: React.MouseEvent) => void;
  onFileClick: (entry: FileEntry, e: React.MouseEvent) => void;
  onStartRename: (path: string) => void;
}): React.JSX.Element {
  const {
    selectedPaths,
    renamingPath,
    creatingEntry,
    expandedDirs,
    dragOverPath,
    dragSourcePaths,
    focusedPath,
    gitBadges,
  } = useFileTreeContext();

  const paddingLeft = treeIndent(depth);
  const isExpanded = expandedDirs.has(entry.path);
  const isRenaming = renamingPath === entry.path;
  const isSelected = selectedPaths.has(entry.path);
  const isDragOver = dragOverPath === entry.path;
  const isDragSource = dragSourcePaths.includes(entry.path);
  const isFocused = focusedPath === entry.path;
  const inputRef = useRef<HTMLInputElement>(null);

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

  const badgeKey = toBadgeKey(entry.path);
  const git: GitDot = entry.isDir
    ? gitBadges.dirs.has(badgeKey)
      ? "changes"
      : null
    : (gitBadges.files.get(badgeKey) ?? null);
  const body = (
    <FileTreeRowBody
      entry={entry}
      git={git}
      inputRef={inputRef}
      isRenaming={isRenaming}
      onCancelRename={onCancelRename}
      onConfirmRename={onConfirmRename}
      onStartRename={onStartRename}
    />
  );

  if (entry.isDir) {
    return (
      <div
        className={isDragOver ? "file-tree-drop-target" : ""}
        data-drop-path={entry.path}
      >
        <div
          aria-expanded={isExpanded}
          aria-level={depth + 1}
          aria-selected={isSelected}
          className={`file-tree-item file-tree-dir ${isSelected ? "file-tree-item-active" : ""}`}
          data-tree-path={entry.path}
          onClick={(e) => onDirClick(entry, e)}
          onContextMenu={(e) => onContextMenu(e, entry.path, true)}
          role="treeitem"
          style={{ paddingLeft }}
          tabIndex={isFocused ? 0 : -1}
        >
          <span
            className={`file-tree-icon file-tree-chevron ${isExpanded ? "file-tree-chevron-open" : ""}`}
          >
            <ChevronRight size={12} />
          </span>
          {body}
        </div>
        {/* Children render here, outside the leaf: a decoration change re-renders the leaf only. */}
        {isExpanded && (
          <>
            {showCreateInput && (
              <CreateInputRow
                creatingEntry={creatingEntry!}
                depth={depth + 1}
                onCancelCreate={onCancelCreate}
                onConfirmCreate={onConfirmCreate}
              />
            )}
            {entry.children?.map((child) => (
              <FileTreeNode
                depth={depth + 1}
                entry={child}
                key={child.path}
                onCancelCreate={onCancelCreate}
                onCancelRename={onCancelRename}
                onConfirmCreate={onConfirmCreate}
                onConfirmRename={onConfirmRename}
                onContextMenu={onContextMenu}
                onDirClick={onDirClick}
                onFileClick={onFileClick}
                onStartRename={onStartRename}
              />
            ))}
          </>
        )}
      </div>
    );
  }

  // File item -- drag source (detected by data-file-path via mouse events at root)
  return (
    <div
      aria-level={depth + 1}
      aria-selected={isSelected}
      className={`file-tree-item file-tree-file ${isSelected ? "file-tree-item-active" : ""} ${isDragSource ? "opacity-40" : ""}`}
      data-file-path={entry.path}
      data-tree-path={entry.path}
      onClick={(e) => !isRenaming && onFileClick(entry, e)}
      onContextMenu={(e) => onContextMenu(e, entry.path, false)}
      role="treeitem"
      style={{ paddingLeft }}
      tabIndex={isFocused ? 0 : -1}
    >
      {body}
    </div>
  );
}

// --- CreateInput row ---
function CreateInputRow({
  creatingEntry,
  depth,
  onConfirmCreate,
  onCancelCreate,
}: {
  creatingEntry: CreatingEntryState;
  depth: number;
  onCancelCreate: () => void;
  onConfirmCreate: (name: string) => void;
}): React.JSX.Element {
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    createInputRef.current?.focus();
  }, []);

  return (
    <div className="file-tree-item" style={{ paddingLeft: treeIndent(depth) }}>
      <span className="file-tree-icon">
        {creatingEntry.isDir ? <IconFolder /> : <IconFile />}
      </span>
      <RenameInput
        inputRef={createInputRef}
        onCancel={onCancelCreate}
        onConfirm={onConfirmCreate}
        placeholder={creatingEntry.isDir ? "folder name" : "file name"}
      />
    </div>
  );
}

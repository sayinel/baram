// §4.3 File tree — recursive tree node component
// Reads 6 shared states from FileTreeContext; receives only 10 handler props.
import { useEffect, useRef } from "react";

import type { FileEntry } from "../../stores/file/file";
import type { CreatingEntryState } from "./file-tree-types";

import { getFileIcon } from "./file-icon";
import { IconFile, IconFolder } from "./file-tree-icons";
import { TREE_BASE_PADDING_PX, TREE_INDENT_PX } from "./file-tree-types";
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
  } = useFileTreeContext();

  const paddingLeft = `${depth * TREE_INDENT_PX + TREE_BASE_PADDING_PX}px`;
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
            {"\u25B6"}
          </span>
          <span className="file-tree-icon">
            <IconFolder />
          </span>
          {isRenaming ? (
            <RenameInput
              defaultValue={entry.name}
              inputRef={inputRef}
              onCancel={onCancelRename}
              onConfirm={(val) => onConfirmRename(entry.path, val)}
            />
          ) : (
            <span
              className="file-tree-name text-truncate"
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
      <span className="file-tree-icon">{getFileIcon(entry.name)}</span>
      {isRenaming ? (
        <RenameInput
          defaultValue={entry.name}
          inputRef={inputRef}
          onCancel={onCancelRename}
          onConfirm={(val) => onConfirmRename(entry.path, val)}
        />
      ) : (
        <span
          className="file-tree-name text-truncate"
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
    <div
      className="file-tree-item"
      style={{
        paddingLeft: `${depth * TREE_INDENT_PX + TREE_BASE_PADDING_PX}px`,
      }}
    >
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

// --- RenameInput (deduplicated from 4 inline occurrences) ---
function RenameInput({
  defaultValue,
  onConfirm,
  onCancel,
  inputRef,
  placeholder,
}: {
  defaultValue?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onConfirm: (value: string) => void;
  placeholder?: string;
}): React.JSX.Element {
  return (
    <input
      autoFocus={!defaultValue}
      className="file-tree-rename-input"
      defaultValue={defaultValue}
      onBlur={(e) => {
        const val = e.target.value;
        if (defaultValue !== undefined) {
          onConfirm(val);
        } else {
          if (val.trim()) onConfirm(val);
          else onCancel();
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onConfirm((e.target as HTMLInputElement).value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
        e.stopPropagation();
      }}
      placeholder={placeholder}
      ref={inputRef}
    />
  );
}

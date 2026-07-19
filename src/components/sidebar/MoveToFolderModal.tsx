// §4.3 File tree — Move-to-folder picker modal
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useShallow } from "zustand/shallow";

import { type FileEntry, useFileStore } from "../../stores/file/file";
import { IconFolder } from "./file-tree-icons";
import { useFileTreeMove } from "./hooks/use-file-tree-move";

interface FolderOption {
  depth: number;
  name: string;
  path: string;
}

export function MoveToFolderModal({
  sources,
  onClose,
}: {
  onClose: () => void;
  sources: string[];
}): null | React.JSX.Element {
  const { fileTree, rootPath } = useFileStore(
    useShallow((s) => ({ fileTree: s.fileTree, rootPath: s.rootPath })),
  );
  const { moveEntries } = useFileTreeMove();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedRef = useRef<HTMLDivElement>(null);

  const folders = useMemo((): FolderOption[] => {
    if (!rootPath) return [];
    const all: FolderOption[] = [
      { path: rootPath, name: "/ (vault root)", depth: 0 },
      ...collectFolders(fileTree, 0),
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
  }, [fileTree, rootPath, query]);

  // Keep the highlighted row in range as the filtered list shrinks/grows.
  useEffect(() => {
    if (selectedIndex >= folders.length) {
      setSelectedIndex(Math.max(0, folders.length - 1));
    }
  }, [folders.length, selectedIndex]);

  // Keep the highlighted row visible when navigating with arrow keys.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!rootPath) return null;

  const handlePick = async (target: string): Promise<void> => {
    await moveEntries(sources, target);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, folders.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const target = folders[selectedIndex];
      if (target) handlePick(target.path);
    }
  };

  return createPortal(
    <div className="move-modal-overlay" onClick={onClose}>
      <div
        className="move-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="move-modal-title">
          Move {sources.length} item{sources.length !== 1 ? "s" : ""} to…
        </div>
        <input
          autoFocus
          className="move-modal-search"
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          placeholder="Filter folders…"
          value={query}
        />
        <div className="move-modal-list">
          {folders.length === 0 ? (
            <div className="move-modal-empty">No folders match</div>
          ) : (
            folders.map((f, idx) => (
              <div
                className={`move-modal-item ${idx === selectedIndex ? "move-modal-item-selected" : ""}`}
                key={f.path}
                onClick={() => handlePick(f.path)}
                onMouseEnter={() => setSelectedIndex(idx)}
                ref={idx === selectedIndex ? selectedRef : null}
                style={{ paddingLeft: `${16 + f.depth * 12}px` }}
              >
                <span className="file-tree-icon">
                  <IconFolder />
                </span>
                <span className="move-modal-item-name">{f.name}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function collectFolders(tree: FileEntry[], depth: number): FolderOption[] {
  const out: FolderOption[] = [];
  for (const e of tree) {
    if (e.isDir) {
      out.push({ path: e.path, name: e.name, depth });
      if (e.children) out.push(...collectFolders(e.children, depth + 1));
    }
  }
  return out;
}

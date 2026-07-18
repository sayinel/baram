// §4.3 File tree — Move-to-folder picker modal
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { useShallow } from "zustand/shallow";

import { type FileEntry, useFileStore } from "../../stores/file/file";
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

  const folders = useMemo((): FolderOption[] => {
    if (!rootPath) return [];
    const all: FolderOption[] = [
      { path: rootPath, name: "/ (vault root)", depth: 0 },
      ...collectFolders(fileTree, 0),
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
  }, [fileTree, rootPath, query]);

  if (!rootPath) return null;

  const handlePick = async (target: string): Promise<void> => {
    await moveEntries(sources, target);
    onClose();
  };

  return createPortal(
    <div className="move-modal-overlay" onClick={onClose}>
      <div className="move-modal" onClick={(e) => e.stopPropagation()}>
        <div className="move-modal-title">
          Move {sources.length} item{sources.length !== 1 ? "s" : ""} to…
        </div>
        <input
          autoFocus
          className="move-modal-search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Filter folders…"
          value={query}
        />
        <div className="move-modal-list">
          {folders.map((f) => (
            <div
              className="move-modal-item"
              key={f.path}
              onClick={() => handlePick(f.path)}
              style={{ paddingLeft: `${8 + f.depth * 12}px` }}
            >
              {f.name}
            </div>
          ))}
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

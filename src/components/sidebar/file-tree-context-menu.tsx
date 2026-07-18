// §4.3 File tree — context menu component (extracted from FileTree.tsx)
import type { ContextMenuState } from "./file-tree-types";

const REVEAL_LABEL =
  typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
    ? "Reveal in Finder"
    : "Show in File Manager";

export interface FileTreeContextMenuProps {
  menu: ContextMenuState;
  onAction: (action: string) => void;
}

export function FileTreeContextMenu({
  menu,
  onAction,
}: FileTreeContextMenuProps): React.JSX.Element {
  const isEmptyArea = menu.targetPath === null;
  return (
    <div
      className="file-tree-context-menu"
      onClick={(e) => e.stopPropagation()}
      style={{ left: menu.x, top: menu.y }}
    >
      {(isEmptyArea || menu.targetIsDir) && (
        <>
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("newFile")}
          >
            New File
          </div>
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("newFolder")}
          >
            New Folder
          </div>
        </>
      )}
      {!isEmptyArea && (
        <>
          {menu.targetIsDir && (
            <div className="file-tree-context-menu-separator" />
          )}
          {!menu.targetIsDir && (
            <div
              className="file-tree-context-menu-item"
              onClick={() => onAction("duplicate")}
            >
              Duplicate
            </div>
          )}
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("rename")}
          >
            Rename
          </div>
          <div
            className="file-tree-context-menu-item file-tree-context-menu-item-danger"
            onClick={() => onAction("delete")}
          >
            Delete
          </div>
          <div className="file-tree-context-menu-separator" />
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("copyPath")}
          >
            Copy Path
          </div>
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("copyRelativePath")}
          >
            Copy Relative Path
          </div>
          {!menu.targetIsDir && (
            <div
              className="file-tree-context-menu-item"
              onClick={() => onAction("copyWikilink")}
            >
              Copy as Wikilink
            </div>
          )}
          <div className="file-tree-context-menu-separator" />
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("reveal")}
          >
            {REVEAL_LABEL}
          </div>
        </>
      )}
    </div>
  );
}

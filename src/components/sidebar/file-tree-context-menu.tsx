// §4.3 File tree — context menu component (extracted from FileTree.tsx)
import type { ContextMenuState } from "./file-tree-types";

import { useMenuPlacement } from "../../hooks/use-menu-placement";

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
  const isMulti = menu.selectionCount > 1;
  // §312 clientX/clientY straight into `fixed` coordinates clipped the menu against the
  // window on a right-click near an edge — the same defect the Tasks triage menu had, so
  // it shares that fix's arithmetic rather than restating the rule here. This menu's
  // anchor is the cursor, a zero-height rect: flipping puts the menu's bottom on the
  // cursor, which is what a native context menu does. Only one branch below renders at a
  // time, so both can carry the same ref.
  const { position, ref } = useMenuPlacement<HTMLDivElement>({
    bottom: menu.y,
    left: menu.x,
    top: menu.y,
  });
  if (isMulti) {
    return (
      <div
        className="file-tree-context-menu"
        onClick={(e) => e.stopPropagation()}
        ref={ref}
        style={{ left: position.x, top: position.y }}
      >
        <div
          className={`file-tree-context-menu-item ${menu.selectionHasDir ? "file-tree-context-menu-item-disabled" : ""}`}
          onClick={() => !menu.selectionHasDir && onAction("duplicate")}
        >
          Duplicate
        </div>
        <div
          className="file-tree-context-menu-item"
          onClick={() => onAction("move")}
        >
          Move to…
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
      </div>
    );
  }
  return (
    <div
      className="file-tree-context-menu"
      onClick={(e) => e.stopPropagation()}
      ref={ref}
      style={{ left: position.x, top: position.y }}
    >
      {!isEmptyArea && !menu.targetIsDir && (
        <>
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("openInNewTab")}
          >
            Open in New Tab
          </div>
          <div className="file-tree-context-menu-separator" />
        </>
      )}
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
            className="file-tree-context-menu-item"
            onClick={() => onAction("move")}
          >
            Move to…
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
          {!menu.targetIsDir && (
            <div
              className="file-tree-context-menu-item"
              onClick={() => onAction("export")}
            >
              Export…
            </div>
          )}
          {!menu.targetIsDir && (
            <div
              className="file-tree-context-menu-item"
              onClick={() => onAction("versionHistory")}
            >
              Version History
            </div>
          )}
        </>
      )}
    </div>
  );
}

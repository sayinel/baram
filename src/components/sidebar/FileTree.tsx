// §4.3 File tree sidebar — stub for AppLayout, full implementation in Task #29
import { useFileStore, type FileEntry } from "../../stores/file-store";

function FileTreeNode({ entry, depth }: { entry: FileEntry; depth: number }) {
  const paddingLeft = `${depth * 16 + 8}px`;

  if (entry.isDir) {
    return (
      <div>
        <div
          className="file-tree-item file-tree-dir"
          style={{ paddingLeft }}
        >
          <span className="file-tree-icon">{"\u25B6"}</span>
          <span className="file-tree-name">{entry.name}</span>
        </div>
        {entry.children?.map((child) => (
          <FileTreeNode key={child.path} entry={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  return (
    <div
      className="file-tree-item file-tree-file"
      style={{ paddingLeft }}
    >
      <span className="file-tree-icon">{"\uD83D\uDCC4"}</span>
      <span className="file-tree-name">{entry.name}</span>
    </div>
  );
}

export function FileTree() {
  const { fileTree, rootPath } = useFileStore();

  if (!rootPath) {
    return (
      <div className="file-tree-empty">
        <p>No folder open</p>
        <button className="file-tree-open-btn">Open Folder</button>
      </div>
    );
  }

  return (
    <div className="file-tree">
      {fileTree.map((entry) => (
        <FileTreeNode key={entry.path} entry={entry} depth={0} />
      ))}
    </div>
  );
}

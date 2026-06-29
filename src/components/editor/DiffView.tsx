// Shared line-level diff view. Used by version history and the external-change
// conflict UI. Renders a DiffResult (hunks + stats) computed by the Rust
// diff_texts / get_snapshot_diff commands.
import type { DiffResult } from "../../ipc/types";

interface DiffViewProps {
  diff: DiffResult;
  filePath: string;
  onClose?: () => void;
}

export function DiffView({ diff, filePath, onClose }: DiffViewProps) {
  return (
    <div className="snapshot-diff-view">
      <div className="snapshot-diff-header">
        <span className="snapshot-diff-path">{filePath}</span>
        <span className="snapshot-diff-stats">
          <span className="diff-additions">+{diff.stats.additions}</span>
          <span className="diff-deletions">-{diff.stats.deletions}</span>
        </span>
        {onClose && (
          <button
            className="snapshot-action-btn"
            onClick={onClose}
            title="Close diff"
          >
            {"✕"}
          </button>
        )}
      </div>
      <div className="snapshot-diff-content">
        {diff.hunks.map((hunk, i) => (
          <div className="diff-hunk" key={i}>
            <div className="diff-hunk-header">
              @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},
              {hunk.newCount} @@
            </div>
            {hunk.changes.map((change, j) => (
              <div className={`diff-line diff-${change.type}`} key={j}>
                <span className="diff-line-prefix">
                  {change.type === "insert"
                    ? "+"
                    : change.type === "delete"
                      ? "-"
                      : " "}
                </span>
                <span className="diff-line-content">{change.content}</span>
              </div>
            ))}
          </div>
        ))}
        {diff.hunks.length === 0 && (
          <div className="snapshot-empty">No differences</div>
        )}
      </div>
    </div>
  );
}

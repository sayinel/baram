// §71 File-scoped version history view -- sidebar
import { useShallow } from "zustand/shallow";

import { useSnapshotStore } from "../../stores/editor/snapshot";
import { formatSnapshotTime } from "../../stores/editor/snapshot-time";
import { distinctFileVersions } from "../../stores/editor/snapshot-versions";
import { useFileStore } from "../../stores/file/file";
import { basename } from "../../utils/path-utils";
import { DiffView } from "../editor/DiffView";

export function FileHistoryView() {
  const rootPath = useFileStore((s) => s.rootPath);
  const {
    fileHistory,
    fileHistoryPath,
    loading,
    activeDiff,
    loadDiff,
    performRestore,
    clearFileHistory,
    closeDiff,
    restoring,
    error,
    restoreMessage,
  } = useSnapshotStore(
    useShallow((s) => ({
      fileHistory: s.fileHistory,
      fileHistoryPath: s.fileHistoryPath,
      loading: s.loading,
      activeDiff: s.activeDiff,
      loadDiff: s.loadDiff,
      performRestore: s.performRestore,
      clearFileHistory: s.clearFileHistory,
      closeDiff: s.closeDiff,
      restoring: s.restoring,
      error: s.error,
      restoreMessage: s.restoreMessage,
    })),
  );

  if (!fileHistoryPath || !rootPath) return null;
  const versions = distinctFileVersions(fileHistory, fileHistoryPath);

  const back = () => {
    closeDiff();
    clearFileHistory();
  };

  return (
    <div className="sidebar-panel snapshot-panel file-history-view">
      <div className="snapshot-panel-header">
        <button
          className="snapshot-action-btn"
          onClick={back}
          title="All snapshots"
        >
          {"←"} All snapshots
        </button>
        <span className="snapshot-panel-title text-truncate">
          {basename(fileHistoryPath)}
        </span>
      </div>

      {loading && <div className="snapshot-loading">Loading history…</div>}
      {!loading && versions.length === 0 && (
        <div className="snapshot-empty">No versions yet for this file.</div>
      )}

      {!loading && versions.length > 0 && (
        <div className="snapshot-list">
          {versions.map((v) => (
            <div className="file-history-version" key={v.id}>
              <button
                className="file-history-version-open"
                onClick={() => loadDiff(rootPath, v.id, fileHistoryPath)}
                title="View changes"
              >
                <span className="file-history-version-time">
                  {formatSnapshotTime(v.timestamp)}
                </span>
                {v.label && (
                  <span className="file-history-version-label">{v.label}</span>
                )}
              </button>
              <button
                className="file-history-version-restore"
                disabled={restoring}
                onClick={() =>
                  performRestore(rootPath, v.id, [fileHistoryPath])
                }
                title="Restore this version"
              >
                {restoring ? "Restoring..." : "Restore"}
              </button>
            </div>
          ))}
        </div>
      )}

      {restoreMessage && (
        <div className="snapshot-restore-message">{restoreMessage}</div>
      )}
      {error && <div className="snapshot-error">{error}</div>}

      {activeDiff && (
        <DiffView
          diff={activeDiff.diff}
          filePath={activeDiff.filePath}
          onClose={closeDiff}
        />
      )}
    </div>
  );
}

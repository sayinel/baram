// §71 Version History Panel -- sidebar
import { useEffect, useCallback, useState } from "react";
import { useSnapshotStore } from "../../stores/snapshot-store";
import { useFileStore } from "../../stores/file-store";
import type { SnapshotEntry, DiffResult } from "../../ipc/types";

function parseTimestamp(timestamp: string): Date {
  // Rust backend uses filesystem-safe format: "2026-03-07T10-00-00" (hyphens instead of colons)
  // Convert to standard ISO 8601: "2026-03-07T10:00:00"
  const iso = timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
  return new Date(iso);
}

function formatSnapshotTime(timestamp: string): string {
  const date = parseTimestamp(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SnapshotItem({ snapshot, isSelected, onSelect }: {
  snapshot: SnapshotEntry;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`snapshot-item ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
    >
      <div className="snapshot-item-header">
        <span className="snapshot-item-icon">
          {snapshot.type === "manual" ? "\u2605" : "\u25CF"}
        </span>
        <span className="snapshot-item-time">
          {formatSnapshotTime(snapshot.timestamp)}
        </span>
        <span className="snapshot-item-type">
          {snapshot.type === "manual" ? "manual" : "auto"}
        </span>
      </div>
      {snapshot.label && (
        <div className="snapshot-item-label">{snapshot.label}</div>
      )}
      <div className="snapshot-item-meta">
        {snapshot.files.length} file{snapshot.files.length !== 1 ? "s" : ""} · {formatBytes(snapshot.totalSizeBytes)}
      </div>
    </div>
  );
}

// DiffView component for showing file diffs
function DiffView({ diff, filePath, onClose }: {
  diff: DiffResult;
  filePath: string;
  onClose: () => void;
}) {
  return (
    <div className="snapshot-diff-view">
      <div className="snapshot-diff-header">
        <span className="snapshot-diff-path">{filePath}</span>
        <span className="snapshot-diff-stats">
          <span className="diff-additions">+{diff.stats.additions}</span>
          <span className="diff-deletions">-{diff.stats.deletions}</span>
        </span>
        <button className="snapshot-action-btn" onClick={onClose} title="Close diff">
          \u2715
        </button>
      </div>
      <div className="snapshot-diff-content">
        {diff.hunks.map((hunk, i) => (
          <div key={i} className="diff-hunk">
            <div className="diff-hunk-header">
              @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
            </div>
            {hunk.changes.map((change, j) => (
              <div key={j} className={`diff-line diff-${change.type}`}>
                <span className="diff-line-prefix">
                  {change.type === "insert" ? "+" : change.type === "delete" ? "-" : " "}
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

// SnapshotDetail -- shows files in selected snapshot
function SnapshotDetail({ vaultPath, onBack }: {
  vaultPath: string;
  onBack: () => void;
}) {
  const {
    snapshots,
    selectedSnapshotId,
    selectedFiles,
    activeDiff,
    diffLoading,
    restoring,
    toggleFileSelection,
    selectAllFiles,
    deselectAllFiles,
    loadDiff,
    closeDiff,
    performRestore,
    performDelete,
  } = useSnapshotStore();

  const snapshot = snapshots.find((s) => s.id === selectedSnapshotId);
  if (!snapshot) return null;

  const allSelected = selectedFiles.length === snapshot.files.length;

  return (
    <div className="snapshot-detail">
      <div className="snapshot-detail-header">
        <button className="snapshot-back-btn" onClick={onBack}>
          {"\u2190"} Back
        </button>
        <div className="snapshot-detail-info">
          <div className="snapshot-detail-time">
            {parseTimestamp(snapshot.timestamp).toLocaleString()}
          </div>
          <div className="snapshot-detail-type">
            {snapshot.type === "manual" ? "\u2605 Manual" : "Auto"}
            {snapshot.label && ` \u2014 ${snapshot.label}`}
          </div>
        </div>
        <button
          className="snapshot-action-btn danger"
          onClick={() => performDelete(vaultPath, snapshot.id)}
          title="Delete snapshot"
        >
          {"\u{1F5D1}"}
        </button>
      </div>

      {/* File list with checkboxes */}
      <div className="snapshot-files-header">
        <label className="snapshot-checkbox-label">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => allSelected ? deselectAllFiles() : selectAllFiles()}
          />
          <span>
            {snapshot.files.length} file{snapshot.files.length !== 1 ? "s" : ""}
          </span>
        </label>
      </div>

      <div className="snapshot-files-list">
        {snapshot.files.map((file) => {
          const fileName = file.path.split("/").pop() || file.path;
          const dirPath = file.path.includes("/")
            ? file.path.substring(0, file.path.lastIndexOf("/"))
            : "";
          return (
            <div key={file.path} className="snapshot-file-item">
              <input
                type="checkbox"
                checked={selectedFiles.includes(file.path)}
                onChange={() => toggleFileSelection(file.path)}
              />
              <span
                className="snapshot-file-name"
                onClick={() => loadDiff(vaultPath, snapshot.id, file.path)}
                title="Click to view diff"
              >
                {fileName}
                {dirPath && <span className="snapshot-file-dir"> {dirPath}</span>}
              </span>
              <span className="snapshot-file-size">{formatBytes(file.sizeBytes)}</span>
            </div>
          );
        })}
      </div>

      {/* Diff view */}
      {diffLoading && <div className="snapshot-loading">Loading diff...</div>}
      {activeDiff && !diffLoading && (
        <DiffView diff={activeDiff.diff} filePath={activeDiff.filePath} onClose={closeDiff} />
      )}

      {/* Restore buttons */}
      <div className="snapshot-restore-bar">
        <button
          className="snapshot-restore-btn"
          disabled={restoring || selectedFiles.length === 0}
          onClick={() => performRestore(vaultPath, snapshot.id, selectedFiles)}
        >
          {restoring ? "Restoring..." : `Restore ${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""}`}
        </button>
        <button
          className="snapshot-restore-btn secondary"
          disabled={restoring}
          onClick={() => performRestore(vaultPath, snapshot.id)}
        >
          {restoring ? "Restoring..." : "Restore All"}
        </button>
      </div>
    </div>
  );
}

export function VersionHistoryPanel() {
  const rootPath = useFileStore((s) => s.rootPath);
  const {
    snapshots,
    loading,
    error,
    selectedSnapshotId,
    creating,
    loadSnapshots,
    selectSnapshot,
    performCreate,
  } = useSnapshotStore();

  const [showLabelInput, setShowLabelInput] = useState(false);
  const [labelInput, setLabelInput] = useState("");

  const refresh = useCallback(() => {
    if (rootPath) loadSnapshots(rootPath);
  }, [rootPath, loadSnapshots]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!rootPath) {
    return (
      <div className="sidebar-panel snapshot-panel">
        <div className="snapshot-empty">Open a vault to view snapshots</div>
      </div>
    );
  }

  // Detail view when snapshot is selected
  if (selectedSnapshotId) {
    return (
      <div className="sidebar-panel snapshot-panel">
        <SnapshotDetail vaultPath={rootPath} onBack={() => selectSnapshot(null)} />
      </div>
    );
  }

  const handleCreate = async () => {
    if (!rootPath) return;
    try {
      await performCreate(rootPath, labelInput || undefined);
      setShowLabelInput(false);
      setLabelInput("");
    } catch {
      // error is in store
    }
  };

  return (
    <div className="sidebar-panel snapshot-panel">
      <div className="snapshot-panel-header">
        <span className="snapshot-panel-title">Version History</span>
        <div className="snapshot-panel-actions">
          <button
            className="snapshot-action-btn"
            onClick={refresh}
            title="Refresh"
          >
            {"\u21BB"}
          </button>
          <button
            className="snapshot-action-btn"
            onClick={() => setShowLabelInput(!showLabelInput)}
            title="Create snapshot"
          >
            +
          </button>
        </div>
      </div>

      {/* Create snapshot form */}
      {showLabelInput && (
        <div className="snapshot-create-form">
          <input
            type="text"
            className="snapshot-label-input"
            placeholder="Label (optional)"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") { setShowLabelInput(false); setLabelInput(""); }
            }}
            autoFocus
          />
          <button
            className="snapshot-create-btn"
            onClick={handleCreate}
            disabled={creating}
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      )}

      {error && <div className="snapshot-error">{error}</div>}

      {loading && <div className="snapshot-loading">Loading snapshots...</div>}

      {!loading && snapshots.length === 0 && (
        <div className="snapshot-empty">
          No snapshots yet. Click + to create one.
        </div>
      )}

      {!loading && snapshots.length > 0 && (
        <div className="snapshot-list">
          {snapshots.map((snap) => (
            <SnapshotItem
              key={snap.id}
              snapshot={snap}
              isSelected={selectedSnapshotId === snap.id}
              onSelect={() => selectSnapshot(snap.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

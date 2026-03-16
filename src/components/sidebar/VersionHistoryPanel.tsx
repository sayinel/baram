// §71 Version History Panel -- sidebar
import { useCallback, useEffect, useState } from "react";

import type { DiffResult, SnapshotEntry } from "../../ipc/types";

import { useSnapshotStore } from "../../stores/editor/snapshot";
import { useFileStore } from "../../stores/file/file";

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
        <SnapshotDetail
          onBack={() => selectSnapshot(null)}
          vaultPath={rootPath}
        />
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
            autoFocus
            className="snapshot-label-input"
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") {
                setShowLabelInput(false);
                setLabelInput("");
              }
            }}
            placeholder="Label (optional)"
            type="text"
            value={labelInput}
          />
          <button
            className="snapshot-create-btn"
            disabled={creating}
            onClick={handleCreate}
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
              isSelected={selectedSnapshotId === snap.id}
              key={snap.id}
              onSelect={() => selectSnapshot(snap.id)}
              snapshot={snap}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// DiffView component for showing file diffs
function DiffView({
  diff,
  filePath,
  onClose,
}: {
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
        <button
          className="snapshot-action-btn"
          onClick={onClose}
          title="Close diff"
        >
          {"\u2715"}
        </button>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function parseTimestamp(timestamp: string): Date {
  // Rust backend uses filesystem-safe UTC format: "2026-03-07T10-00-00" (hyphens instead of colons)
  // Convert to standard ISO 8601 with UTC indicator: "2026-03-07T10:00:00Z"
  const iso = timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3Z");
  return new Date(iso);
}

// SnapshotDetail -- shows files in selected snapshot
function SnapshotDetail({
  vaultPath,
  onBack,
}: {
  onBack: () => void;
  vaultPath: string;
}) {
  const {
    snapshots,
    selectedSnapshotId,
    selectedFiles,
    activeDiff,
    diffLoading,
    restoring,
    restoreMessage,
    error,
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
            checked={allSelected}
            onChange={() =>
              allSelected ? deselectAllFiles() : selectAllFiles()
            }
            type="checkbox"
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
            <div className="snapshot-file-item" key={file.path}>
              <input
                checked={selectedFiles.includes(file.path)}
                onChange={() => toggleFileSelection(file.path)}
                type="checkbox"
              />
              <span
                className="snapshot-file-name text-truncate"
                onClick={() => loadDiff(vaultPath, snapshot.id, file.path)}
                title="Click to view diff"
              >
                {fileName}
                {dirPath && (
                  <span className="snapshot-file-dir"> {dirPath}</span>
                )}
              </span>
              <span className="snapshot-file-size">
                {formatBytes(file.sizeBytes)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Diff view */}
      {diffLoading && <div className="snapshot-loading">Loading diff...</div>}
      {activeDiff && !diffLoading && (
        <DiffView
          diff={activeDiff.diff}
          filePath={activeDiff.filePath}
          onClose={closeDiff}
        />
      )}

      {/* Restore feedback */}
      {restoreMessage && (
        <div className="snapshot-restore-message">{restoreMessage}</div>
      )}
      {error && <div className="snapshot-error">{error}</div>}

      {/* Restore buttons */}
      <div className="snapshot-restore-bar">
        <button
          className="snapshot-restore-btn"
          disabled={restoring || selectedFiles.length === 0}
          onClick={() => performRestore(vaultPath, snapshot.id, selectedFiles)}
        >
          {restoring
            ? "Restoring..."
            : `Restore ${selectedFiles.length} file${selectedFiles.length !== 1 ? "s" : ""}`}
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

function SnapshotItem({
  snapshot,
  isSelected,
  onSelect,
}: {
  isSelected: boolean;
  onSelect: () => void;
  snapshot: SnapshotEntry;
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
        {snapshot.files.length} file{snapshot.files.length !== 1 ? "s" : ""} ·{" "}
        {formatBytes(snapshot.totalSizeBytes)}
      </div>
    </div>
  );
}

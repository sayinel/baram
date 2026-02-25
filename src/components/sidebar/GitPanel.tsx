// §57b Git Source Control Panel — sidebar
import { useEffect, useCallback } from "react";
import { useGitStore, groupChanges, statusIcon, statusColorClass } from "../../stores/git-store";
import { useFileStore } from "../../stores/file-store";
// file-store uses rootPath for the vault directory
import type { GitChange } from "../../ipc/types";

function ChangeItem({
  change,
  onStage,
  onUnstage,
  onDiscard,
  onDiff,
}: {
  change: GitChange;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onDiff: () => void;
}) {
  const fileName = change.path.split("/").pop() || change.path;
  const dirPath = change.path.includes("/")
    ? change.path.substring(0, change.path.lastIndexOf("/"))
    : "";

  return (
    <div className="git-change-item" onDoubleClick={onDiff}>
      <span className={`git-change-icon ${statusColorClass(change.status)}`}>
        {statusIcon(change.status)}
      </span>
      <span className="git-change-name" title={change.path}>
        {fileName}
        {dirPath && <span className="git-change-dir"> {dirPath}</span>}
      </span>
      <div className="git-change-actions">
        {change.staged ? (
          <button
            className="git-action-btn"
            onClick={onUnstage}
            title="Unstage"
          >
            −
          </button>
        ) : (
          <>
            <button
              className="git-action-btn"
              onClick={onDiscard}
              title="Discard changes"
            >
              ↺
            </button>
            <button
              className="git-action-btn"
              onClick={onStage}
              title="Stage"
            >
              +
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function GitPanel() {
  const {
    isRepo,
    branch,
    changes,
    loading,
    error,
    commitMessage,
    committing,
    activeDiff,
    diffLoading,
    refresh,
    stageFiles,
    unstageFiles,
    stageAll,
    unstageAll,
    commitChanges,
    discardFiles,
    loadDiff,
    closeDiff,
    setCommitMessage,
  } = useGitStore();

  const vaultPath = useFileStore((s) => s.rootPath);

  // Refresh on mount and when vaultPath changes
  useEffect(() => {
    if (vaultPath) refresh(vaultPath);
  }, [vaultPath, refresh]);

  // Auto-refresh on file save (listen for file:changed events)
  useEffect(() => {
    if (!vaultPath) return;
    const timer = setInterval(() => refresh(vaultPath), 5000);
    return () => clearInterval(timer);
  }, [vaultPath, refresh]);

  const handleCommit = useCallback(() => {
    if (vaultPath) commitChanges(vaultPath);
  }, [vaultPath, commitChanges]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleCommit();
      }
    },
    [handleCommit],
  );

  if (!vaultPath) {
    return (
      <div className="git-panel">
        <div className="git-panel-empty">No folder open</div>
      </div>
    );
  }

  if (!isRepo) {
    return (
      <div className="git-panel">
        <div className="git-panel-empty">Not a Git repository</div>
      </div>
    );
  }

  const { staged, unstaged } = groupChanges(changes);

  return (
    <div className="git-panel">
      {/* Branch display */}
      <div className="git-branch-bar">
        <span className="git-branch-icon">⎇</span>
        <span className="git-branch-name">{branch}</span>
      </div>

      {/* Commit area */}
      <div className="git-commit-area">
        <textarea
          className="git-commit-input"
          placeholder="Commit message (Cmd+Enter to commit)"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
        <button
          className="git-commit-btn"
          onClick={handleCommit}
          disabled={committing || !commitMessage.trim() || staged.length === 0}
          title="Commit staged changes"
        >
          {committing ? "Committing..." : "Commit"}
        </button>
      </div>

      {error && <div className="git-error">{error}</div>}

      {/* Staged changes */}
      {staged.length > 0 && (
        <div className="git-section">
          <div className="git-section-header">
            <span>Staged Changes</span>
            <span className="git-section-count">{staged.length}</span>
            <button
              className="git-action-btn"
              onClick={() => vaultPath && unstageAll(vaultPath)}
              title="Unstage all"
            >
              −
            </button>
          </div>
          <div className="git-change-list">
            {staged.map((c) => (
              <ChangeItem
                key={`staged-${c.path}`}
                change={c}

                onStage={() => {}}
                onUnstage={() => unstageFiles(vaultPath, [c.path])}
                onDiscard={() => {}}
                onDiff={() => loadDiff(vaultPath, c.path)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Unstaged changes */}
      {unstaged.length > 0 && (
        <div className="git-section">
          <div className="git-section-header">
            <span>Changes</span>
            <span className="git-section-count">{unstaged.length}</span>
            <button
              className="git-action-btn"
              onClick={() => vaultPath && stageAll(vaultPath)}
              title="Stage all"
            >
              +
            </button>
          </div>
          <div className="git-change-list">
            {unstaged.map((c) => (
              <ChangeItem
                key={`unstaged-${c.path}`}
                change={c}

                onStage={() => stageFiles(vaultPath, [c.path])}
                onUnstage={() => {}}
                onDiscard={() => discardFiles(vaultPath, [c.path])}
                onDiff={() => loadDiff(vaultPath, c.path)}
              />
            ))}
          </div>
        </div>
      )}

      {changes.length === 0 && !loading && (
        <div className="git-panel-empty">No changes</div>
      )}

      {loading && changes.length === 0 && (
        <div className="git-panel-empty">Loading...</div>
      )}

      {/* Diff viewer modal */}
      {activeDiff && (
        <div className="git-diff-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeDiff(); }}>
          <div className="git-diff-modal">
            <div className="git-diff-header">
              <span className="git-diff-filename">{activeDiff.path}</span>
              <button className="git-diff-close" onClick={closeDiff}>Close</button>
            </div>
            <div className="git-diff-body">
              {diffLoading ? (
                <div className="git-diff-loading">Loading diff...</div>
              ) : activeDiff.is_binary ? (
                <div className="git-diff-binary">Binary file</div>
              ) : activeDiff.hunks.length === 0 ? (
                <div className="git-diff-empty">No differences</div>
              ) : (
                activeDiff.hunks.map((hunk, hi) => (
                  <div key={hi} className="git-diff-hunk">
                    <div className="git-diff-hunk-header">{hunk.header}</div>
                    {hunk.lines.map((line, li) => (
                      <div
                        key={li}
                        className={`git-diff-line ${
                          line.origin === "+" ? "git-diff-add" :
                          line.origin === "-" ? "git-diff-del" : ""
                        }`}
                      >
                        <span className="git-diff-lineno">
                          {line.old_lineno ?? " "}
                        </span>
                        <span className="git-diff-lineno">
                          {line.new_lineno ?? " "}
                        </span>
                        <span className="git-diff-origin">{line.origin}</span>
                        <span className="git-diff-content">{line.content}</span>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

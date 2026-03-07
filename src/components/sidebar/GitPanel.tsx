// §57b Git Source Control Panel — sidebar
import { useEffect, useCallback, useState } from "react";
import { useGitStore, groupChanges, statusIcon, statusColorClass } from "../../stores/git-store";
import { useFileStore } from "../../stores/file-store";
// file-store uses rootPath for the vault directory
import type { GitChange } from "../../ipc/types";

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(timestamp * 1000).toLocaleDateString();
}

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
    logEntries,
    logLoading,
    stashEntries,
    stashLoading,
    aheadBehind,
    pushing,
    pulling,
    activeTab,
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
    loadLog,
    loadStash,
    saveStash,
    popStash,
    dropStash,
    loadAheadBehind,
    pushRemote,
    pullRemote,
    setActiveTab,
  } = useGitStore();

  const vaultPath = useFileStore((s) => s.rootPath);

  const [stashMessage, setStashMessage] = useState("");
  const [stashIncludeUntracked, setStashIncludeUntracked] = useState(false);

  // Refresh on mount and when vaultPath changes
  useEffect(() => {
    if (vaultPath) {
      refresh(vaultPath);
      loadAheadBehind(vaultPath);
    }
  }, [vaultPath, refresh, loadAheadBehind]);

  // Auto-refresh on file save (listen for file:changed events)
  useEffect(() => {
    if (!vaultPath) return;
    const timer = setInterval(() => refresh(vaultPath), 5000);
    return () => clearInterval(timer);
  }, [vaultPath, refresh]);

  // Load data when switching tabs
  useEffect(() => {
    if (!vaultPath) return;
    if (activeTab === "history") loadLog(vaultPath);
    if (activeTab === "stash") loadStash(vaultPath);
  }, [activeTab, vaultPath, loadLog, loadStash]);

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

  const handleSaveStash = useCallback(() => {
    if (vaultPath && stashMessage.trim()) {
      saveStash(vaultPath, stashMessage.trim(), stashIncludeUntracked);
      setStashMessage("");
    }
  }, [vaultPath, stashMessage, stashIncludeUntracked, saveStash]);

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
      {/* Branch display with ahead/behind + push/pull */}
      <div className="git-branch-bar">
        <span className="git-branch-icon">⎇</span>
        <span className="git-branch-name">{branch}</span>
        {aheadBehind && (aheadBehind.ahead > 0 || aheadBehind.behind > 0) && (
          <span className="git-ahead-behind">
            {aheadBehind.ahead > 0 && <span>↑{aheadBehind.ahead}</span>}
            {aheadBehind.behind > 0 && <span>↓{aheadBehind.behind}</span>}
          </span>
        )}
        <div className="git-remote-bar">
          <button
            className="git-action-btn"
            onClick={() => vaultPath && pullRemote(vaultPath)}
            disabled={pulling}
            title="Pull"
          >
            {pulling ? "…" : "↓"}
          </button>
          <button
            className="git-action-btn"
            onClick={() => vaultPath && pushRemote(vaultPath)}
            disabled={pushing}
            title="Push"
          >
            {pushing ? "…" : "↑"}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="git-tabs">
        <button
          className={`git-tab${activeTab === "changes" ? " active" : ""}`}
          onClick={() => setActiveTab("changes")}
        >
          Changes
        </button>
        <button
          className={`git-tab${activeTab === "history" ? " active" : ""}`}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
        <button
          className={`git-tab${activeTab === "stash" ? " active" : ""}`}
          onClick={() => setActiveTab("stash")}
        >
          Stash
        </button>
      </div>

      {error && <div className="git-error">{error}</div>}

      {/* Changes tab */}
      {activeTab === "changes" && (
        <>
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
        </>
      )}

      {/* History tab */}
      {activeTab === "history" && (
        <div className="git-log-list">
          {logLoading && <div className="git-panel-empty">Loading...</div>}
          {!logLoading && logEntries.length === 0 && (
            <div className="git-panel-empty">No commits</div>
          )}
          {logEntries.map((entry) => (
            <div key={entry.oid} className="git-log-entry">
              <div className="git-log-header">
                <span className="git-log-oid">{entry.short_oid}</span>
                <span className="git-log-date">{formatRelativeTime(entry.timestamp)}</span>
              </div>
              <div className="git-log-message">{entry.message.split("\n")[0]}</div>
              <div className="git-log-author">{entry.author}</div>
            </div>
          ))}
        </div>
      )}

      {/* Stash tab */}
      {activeTab === "stash" && (
        <div className="git-stash-panel">
          {/* Save stash */}
          <div className="git-commit-area">
            <input
              className="git-commit-input"
              style={{ display: "block", width: "100%", padding: "0.4em", boxSizing: "border-box" }}
              placeholder="Stash message"
              value={stashMessage}
              onChange={(e) => setStashMessage(e.target.value)}
            />
            <label className="git-stash-untracked-label">
              <input
                type="checkbox"
                checked={stashIncludeUntracked}
                onChange={(e) => setStashIncludeUntracked(e.target.checked)}
              />
              {" "}Include untracked files
            </label>
            <button
              className="git-commit-btn"
              onClick={handleSaveStash}
              disabled={!stashMessage.trim()}
              title="Save stash"
            >
              Stash
            </button>
          </div>

          {/* Stash list */}
          <div className="git-stash-list">
            {stashLoading && <div className="git-panel-empty">Loading...</div>}
            {!stashLoading && stashEntries.length === 0 && (
              <div className="git-panel-empty">No stashes</div>
            )}
            {stashEntries.map((entry) => (
              <div key={entry.index} className="git-stash-entry">
                <div className="git-stash-message">{entry.message}</div>
                <div className="git-stash-actions">
                  <button
                    className="git-action-btn"
                    onClick={() => vaultPath && popStash(vaultPath, entry.index)}
                    title="Pop stash"
                  >
                    Pop
                  </button>
                  <button
                    className="git-action-btn"
                    onClick={() => vaultPath && dropStash(vaultPath, entry.index)}
                    title="Drop stash"
                  >
                    Drop
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
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

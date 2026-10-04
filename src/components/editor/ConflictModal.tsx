// §Phase5: External file change conflict modal
// Shown when a cached/open tab's file was modified externally while dirty.
// Diff/compare is folded into Merge (the merge view doubles as a diff view).
import type { ConflictEntry } from "../../stores/ui/conflict-queue";

import { TriangleAlert } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useEditorStore } from "../../stores/editor/editor";
import { useUIStore } from "../../stores/ui/ui";
import { basename } from "../../utils/path-utils";

interface ConflictModalProps {
  filePath: string;
  onKeepLocal: () => void;
  onMerge: () => void;
  onReload: () => void;
}

export function ConflictModal({
  filePath,
  onReload,
  onKeepLocal,
  onMerge,
}: ConflictModalProps) {
  const fileName = basename(filePath);

  return (
    <div className="conflict-modal-overlay">
      <div
        aria-labelledby="conflict-modal-title"
        aria-modal="true"
        className="conflict-modal"
        role="dialog"
      >
        <div aria-hidden="true" className="conflict-modal-icon">
          <TriangleAlert className="icon-inline" size="1em" />
        </div>
        <h2 className="conflict-modal-title" id="conflict-modal-title">
          File Modified Externally
        </h2>
        <p className="conflict-modal-message">
          <strong>{fileName}</strong> has been modified externally.
          <br />
          You have unsaved edits. What would you like to do?
        </p>
        <div className="conflict-modal-actions">
          <button
            autoFocus
            className="conflict-modal-btn conflict-modal-btn-reload"
            onClick={onReload}
          >
            Reload External Changes
          </button>
          <button
            className="conflict-modal-btn conflict-modal-btn-keep"
            onClick={onKeepLocal}
          >
            Keep Local Edits
          </button>
          <button
            className="conflict-modal-btn conflict-modal-btn-merge"
            onClick={onMerge}
          >
            Merge
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * §3.6 Connected wrapper — shows the head of the conflict queue: the first
 * queued conflict whose tab is still open. Mounted once in AppDialogs.
 *
 * `suspended` hides it while a conflict is being worked on (the merge view is
 * open), so a conflict queued meanwhile waits instead of covering the merge.
 */
export function ConflictModalWrapper({
  onKeepLocal,
  onMerge,
  onReload,
  suspended = false,
}: {
  onKeepLocal: (entry: ConflictEntry) => void;
  onMerge: (entry: ConflictEntry) => void;
  onReload: (entry: ConflictEntry) => void;
  suspended?: boolean;
}) {
  const { conflictQueue, resolveConflict } = useUIStore(
    useShallow((s) => ({
      conflictQueue: s.conflictQueue,
      resolveConflict: s.resolveConflict,
    })),
  );
  const tabIds = useEditorStore(useShallow((s) => s.tabs.map((t) => t.id)));

  const head = conflictQueue.find((e) => tabIds.includes(e.tabId));
  if (!head || suspended) return null;

  // Each action resolves the entry it was shown for — the same generation, so
  // a newer event for the tab that arrives meanwhile stays queued.
  const act = (action: (entry: ConflictEntry) => void) => () => {
    resolveConflict(head.tabId, head.generation);
    action(head);
  };

  return (
    <ConflictModal
      filePath={head.filePath}
      onKeepLocal={act(onKeepLocal)}
      onMerge={act(onMerge)}
      onReload={act(onReload)}
    />
  );
}

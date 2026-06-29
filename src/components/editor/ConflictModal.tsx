// §Phase5: External file change conflict modal
// Shown when a keep-alive or cached tab's file was modified externally while dirty.
import { useState } from "react";

import type { DiffResult } from "../../ipc/types";

import { useShallow } from "zustand/shallow";

import { useUIStore } from "../../stores/ui/ui";
import { logger } from "../../utils/logger";
import { basename } from "../../utils/path-utils";
import { DiffView } from "./DiffView";

interface ConflictModalProps {
  externalMtime: number;
  filePath: string;
  onKeepLocal: () => void;
  onMerge: () => void;
  onReload: () => void;
  onShowDiff: (filePath: string) => Promise<DiffResult | null>;
}

export function ConflictModal({
  filePath,
  onReload,
  onKeepLocal,
  onMerge,
  onShowDiff,
}: ConflictModalProps) {
  const fileName = basename(filePath);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const handleToggleDiff = async () => {
    if (diff) {
      setDiff(null);
      return;
    }
    setDiffLoading(true);
    try {
      setDiff(await onShowDiff(filePath));
    } catch (err) {
      logger.warn("[ConflictModal] diff failed", err);
    } finally {
      setDiffLoading(false);
    }
  };

  return (
    <div className="conflict-modal-overlay">
      <div
        aria-labelledby="conflict-modal-title"
        aria-modal="true"
        className={
          diff ? "conflict-modal conflict-modal--with-diff" : "conflict-modal"
        }
        role="dialog"
      >
        <div aria-hidden="true" className="conflict-modal-icon">
          ⚠️
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
          <button
            className="conflict-modal-btn conflict-modal-btn-diff"
            disabled={diffLoading}
            onClick={handleToggleDiff}
          >
            {diffLoading ? "Loading…" : diff ? "Hide Diff" : "Show Diff"}
          </button>
        </div>
        {diff && (
          <div className="conflict-modal-diff">
            <DiffView diff={diff} filePath={filePath} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * §Phase5: Connected wrapper — reads from UIStore and supplies callbacks.
 * Mounted once in App.tsx; shows/hides based on conflictModal store state.
 */
export function ConflictModalWrapper({
  onReload,
  onKeepLocal,
  onMerge,
  onShowDiff,
}: {
  onKeepLocal: (filePath: string) => void;
  onMerge: (filePath: string) => void;
  onReload: (filePath: string, externalMtime: number) => void;
  onShowDiff: (filePath: string) => Promise<DiffResult | null>;
}) {
  const { conflictModal, closeConflictModal } = useUIStore(
    useShallow((s) => ({
      conflictModal: s.conflictModal,
      closeConflictModal: s.closeConflictModal,
    })),
  );

  if (!conflictModal) return null;

  const { filePath, externalMtime } = conflictModal;

  return (
    <ConflictModal
      externalMtime={externalMtime}
      filePath={filePath}
      onKeepLocal={() => {
        closeConflictModal();
        onKeepLocal(filePath);
      }}
      onMerge={() => {
        closeConflictModal();
        onMerge(filePath);
      }}
      onReload={() => {
        closeConflictModal();
        onReload(filePath, externalMtime);
      }}
      onShowDiff={onShowDiff}
    />
  );
}

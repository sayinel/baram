// §Phase5: External file change conflict modal
// Shown when a cached/open tab's file was modified externally while dirty.
// Diff/compare is folded into Merge (the merge view doubles as a diff view).
import { useShallow } from "zustand/shallow";

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
        </div>
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
}: {
  onKeepLocal: (filePath: string) => void;
  onMerge: (filePath: string, base: string) => void;
  onReload: (filePath: string, externalMtime: number) => void;
}) {
  const { conflictModal, closeConflictModal } = useUIStore(
    useShallow((s) => ({
      conflictModal: s.conflictModal,
      closeConflictModal: s.closeConflictModal,
    })),
  );

  if (!conflictModal) return null;

  const { base, externalMtime, filePath } = conflictModal;

  return (
    <ConflictModal
      filePath={filePath}
      onKeepLocal={() => {
        closeConflictModal();
        onKeepLocal(filePath);
      }}
      onMerge={() => {
        closeConflictModal();
        onMerge(filePath, base);
      }}
      onReload={() => {
        closeConflictModal();
        onReload(filePath, externalMtime);
      }}
    />
  );
}

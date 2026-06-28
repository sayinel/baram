// §Phase5: External file change conflict modal
// Shown when a keep-alive or cached tab's file was modified externally while dirty.
import { useShallow } from "zustand/shallow";

import { useUIStore } from "../../stores/ui/ui";
import { basename } from "../../utils/path-utils";

interface ConflictModalProps {
  externalMtime: number;
  filePath: string;
  onKeepLocal: () => void;
  onReload: () => void;
}

export function ConflictModal({
  filePath,
  onReload,
  onKeepLocal,
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
            className="conflict-modal-btn conflict-modal-btn-diff"
            disabled
            title="Diff view coming soon"
          >
            Show Diff
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
}: {
  onKeepLocal: (filePath: string) => void;
  onReload: (filePath: string, externalMtime: number) => void;
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
      onReload={() => {
        closeConflictModal();
        onReload(filePath, externalMtime);
      }}
    />
  );
}

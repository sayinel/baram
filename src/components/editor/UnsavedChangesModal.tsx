// §close-guard: Shared 3-button confirmation for unsaved changes. Used for
// closing a single tab (X button / Cmd+W on an Untitled tab), quitting the
// app, and reloading (§479, View > Reload / CmdOrCtrl+R). Identical look and
// buttons in every case: Cancel / Don't Save / Save.
import { useState } from "react";

import type { CloseGuardDeps } from "../../hooks/use-close-guard";

import { useShallow } from "zustand/shallow";

import { saveAllDirtyForQuit, saveDirtyTab } from "../../hooks/use-close-guard";
import { useTranslation } from "../../i18n/useTranslation";
import { confirmQuit } from "../../ipc/invoke";
import { isFileTab, useEditorStore } from "../../stores/editor/editor";
import { useUIStore } from "../../stores/ui/ui";

export function UnsavedChangesModal(deps: CloseGuardDeps) {
  const { t } = useTranslation();
  const { closeUnsavedModal, unsavedModal } = useUIStore(
    useShallow((s) => ({
      closeUnsavedModal: s.closeUnsavedModal,
      unsavedModal: s.unsavedModal,
    })),
  );
  const dirtyCount = useEditorStore(
    (s) => s.tabs.filter((tab) => tab.isDirty && isFileTab(tab)).length,
  );
  const [saving, setSaving] = useState(false);

  if (!unsavedModal) return null;

  // Reload discards the whole window, so it saves every dirty tab exactly
  // like quit rather than just the active one (§479).
  const saveAll =
    unsavedModal.intent === "quit" || unsavedModal.intent === "reload";
  const tab =
    unsavedModal.intent === "closeTab"
      ? useEditorStore
          .getState()
          .tabs.find((tb) => tb.id === unsavedModal.tabId)
      : undefined;

  const message =
    unsavedModal.intent === "quit"
      ? t("unsavedChanges.quitMessage", { count: String(dirtyCount) })
      : unsavedModal.intent === "reload"
        ? t("unsavedChanges.reloadMessage", { count: String(dirtyCount) })
        : t("unsavedChanges.closeMessage", { name: tab?.title ?? "" });
  const primaryLabel =
    unsavedModal.intent === "quit"
      ? t("unsavedChanges.saveAndQuit")
      : unsavedModal.intent === "reload"
        ? t("unsavedChanges.saveAndReload")
        : t("unsavedChanges.saveAndClose");

  // The terminal action once the decision is resolved: quit, reload, or close the tab.
  const proceed = async () => {
    if (unsavedModal.intent === "quit") {
      await confirmQuit();
    } else if (unsavedModal.intent === "reload") {
      window.location.reload();
    } else {
      useEditorStore.getState().closeTab(unsavedModal.tabId);
    }
  };

  const runSave = async (): Promise<boolean> => {
    if (saveAll) return saveAllDirtyForQuit(deps);
    if (!tab) return true;
    return saveDirtyTab(
      tab,
      useEditorStore.getState().activeTabId,
      deps.handleSave,
    );
  };

  const handleSaveAndProceed = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const ok = await runSave();
      if (ok) {
        closeUnsavedModal();
        await proceed();
      }
      // ok === false: a Save As was cancelled — stay open, changes preserved.
    } finally {
      setSaving(false);
    }
  };

  const handleDontSave = async () => {
    if (saving) return;
    closeUnsavedModal();
    await proceed();
  };

  return (
    <div className="unsaved-modal-overlay">
      <div
        aria-labelledby="unsaved-modal-title"
        aria-modal="true"
        className="unsaved-modal"
        role="dialog"
      >
        <h2 className="unsaved-modal-title" id="unsaved-modal-title">
          {t("unsavedChanges.title")}
        </h2>
        <p className="unsaved-modal-message">{message}</p>
        <div className="unsaved-modal-actions">
          <button
            className="unsaved-modal-btn unsaved-modal-btn-cancel"
            disabled={saving}
            onClick={() => closeUnsavedModal()}
          >
            {t("unsavedChanges.cancel")}
          </button>
          <button
            className="unsaved-modal-btn unsaved-modal-btn-dont-save"
            disabled={saving}
            onClick={handleDontSave}
          >
            {t("unsavedChanges.dontSave")}
          </button>
          <button
            autoFocus
            className="unsaved-modal-btn unsaved-modal-btn-primary"
            disabled={saving}
            onClick={handleSaveAndProceed}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// §close-guard: Shared 3-button confirmation for unsaved changes. Used for
// closing a single tab (X button / Cmd+W on an Untitled tab), quitting the
// app, reloading (§479, View > Reload / CmdOrCtrl+R), and closing the whole
// workspace (§81, File > Close Workspace). Identical look and buttons in every
// case: Cancel / Don't Save / Save.
import { useState } from "react";

import type { CloseGuardDeps } from "../../hooks/use-close-guard";
import type { UnsavedModalRequest } from "../../stores/ui/ui";

import { useShallow } from "zustand/shallow";

import { saveAllDirtyForQuit, saveDirtyTab } from "../../hooks/use-close-guard";
import { useTranslation } from "../../i18n/useTranslation";
import { confirmQuit } from "../../ipc/invoke";
import { isFileTab, useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";

/**
 * The modal copy, per intent.
 *
 * ‼️ `Record<Intent, …>` rather than a ternary chain: `tsc` — not a reviewer, and
 * not a test that happens to enumerate today's intents — is what demands an entry
 * when the union grows. The chains this replaced defaulted a new intent to the
 * single-tab wording in their final `else`.
 */
const MESSAGE_KEY: Record<UnsavedModalRequest["intent"], string> = {
  closeTab: "unsavedChanges.closeMessage",
  closeWorkspace: "unsavedChanges.closeWorkspaceMessage",
  quit: "unsavedChanges.quitMessage",
  reload: "unsavedChanges.reloadMessage",
};

const PRIMARY_KEY: Record<UnsavedModalRequest["intent"], string> = {
  closeTab: "unsavedChanges.saveAndClose",
  closeWorkspace: "unsavedChanges.saveAndCloseWorkspace",
  quit: "unsavedChanges.saveAndQuit",
  reload: "unsavedChanges.saveAndReload",
};

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

  // Every intent but `closeTab` throws away the whole surface — the window (quit,
  // reload) or the workspace (§81) — so all of them save every dirty tab, not just
  // the active one. Phrased as "not closeTab" deliberately: an intent added later
  // inherits the safe answer instead of quietly saving one tab out of many.
  const saveAll = unsavedModal.intent !== "closeTab";
  const tab =
    unsavedModal.intent === "closeTab"
      ? useEditorStore
          .getState()
          .tabs.find((tb) => tb.id === unsavedModal.tabId)
      : undefined;

  const message =
    unsavedModal.intent === "closeTab"
      ? t(MESSAGE_KEY.closeTab, { name: tab?.title ?? "" })
      : t(MESSAGE_KEY[unsavedModal.intent], { count: String(dirtyCount) });
  const primaryLabel = t(PRIMARY_KEY[unsavedModal.intent]);

  // The terminal action once the decision is resolved: quit, reload, close the
  // workspace, or close the tab.
  const proceed = async () => {
    if (unsavedModal.intent === "quit") {
      await confirmQuit();
    } else if (unsavedModal.intent === "reload") {
      window.location.reload();
    } else if (unsavedModal.intent === "closeWorkspace") {
      useFileStore.getState().closeFolder();
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

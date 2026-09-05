// §close-guard: Shared 3-button confirmation for unsaved changes. Used for
// closing a single tab (X button / Cmd+W on an Untitled tab), quitting the
// app, reloading (§479, View > Reload / CmdOrCtrl+R), closing the whole workspace
// (§81, File > Close Workspace) and closing one context (§82, the context tab's x
// and Settings > Vault's remove). Identical look and buttons in every case:
// Cancel / Don't Save / Save.
import { useState } from "react";

import type { CloseGuardDeps } from "../../hooks/use-close-guard";
import type { UnsavedModalRequest } from "../../stores/ui/ui";

import { useShallow } from "zustand/shallow";

import {
  saveAllDirtyForQuit,
  saveDirtyTab,
  saveDirtyTabsForContexts,
} from "../../hooks/use-close-guard";
import { useTranslation } from "../../i18n/useTranslation";
import { confirmQuit } from "../../ipc/invoke";
import { closeContexts } from "../../services/close-context";
import { useContextStore } from "../../stores/context/context";
import { isTabUnsaved, useEditorStore } from "../../stores/editor/editor";
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
  closeContext: "unsavedChanges.closeContextMessage",
  closeTab: "unsavedChanges.closeMessage",
  closeWorkspace: "unsavedChanges.closeWorkspaceMessage",
  quit: "unsavedChanges.quitMessage",
  reload: "unsavedChanges.reloadMessage",
};

const PRIMARY_KEY: Record<UnsavedModalRequest["intent"], string> = {
  closeContext: "unsavedChanges.saveAndCloseContext",
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
  // §82 `closeContext` answers only for its own context; every other intent counts
  // every dirty tab. Derived before the early return below so the hook order never
  // varies with which intent is showing.
  const scopedContextIds =
    unsavedModal?.intent === "closeContext" ? unsavedModal.contextIds : null;
  const dirtyCount = useEditorStore(
    (s) =>
      s.tabs.filter(
        (tab) =>
          isTabUnsaved(tab, s.sourceEditedTabs) &&
          (scopedContextIds === null ||
            scopedContextIds.includes(tab.contextId)),
      ).length,
  );
  const [saving, setSaving] = useState(false);

  if (!unsavedModal) return null;

  const tab =
    unsavedModal.intent === "closeTab"
      ? useEditorStore
          .getState()
          .tabs.find((tb) => tb.id === unsavedModal.tabId)
      : undefined;
  // Name the folders being closed — "Close Others" can be several, and a bare
  // count would not tell the user which ones are about to lose their edits.
  const contextNames =
    unsavedModal.intent === "closeContext"
      ? useContextStore
          .getState()
          .contexts.filter((c) => unsavedModal.contextIds.includes(c.id))
          .map((c) => c.label)
          .join(", ")
      : "";

  // The three message shapes: one tab by name, the closing folders by name and
  // count, a whole surface by count.
  const message =
    unsavedModal.intent === "closeTab"
      ? t(MESSAGE_KEY.closeTab, { name: tab?.title ?? "" })
      : unsavedModal.intent === "closeContext"
        ? t(MESSAGE_KEY.closeContext, {
            count: String(dirtyCount),
            name: contextNames,
          })
        : t(MESSAGE_KEY[unsavedModal.intent], { count: String(dirtyCount) });
  const primaryLabel = t(PRIMARY_KEY[unsavedModal.intent]);

  // The terminal action once the decision is resolved: quit, reload, close the
  // workspace, close one context, or close the tab.
  const proceed = async () => {
    if (unsavedModal.intent === "quit") {
      await confirmQuit();
    } else if (unsavedModal.intent === "reload") {
      window.location.reload();
    } else if (unsavedModal.intent === "closeWorkspace") {
      useFileStore.getState().closeFolder();
    } else if (unsavedModal.intent === "closeContext") {
      await closeContexts(unsavedModal.contextIds);
    } else {
      useEditorStore.getState().closeTab(unsavedModal.tabId);
    }
  };

  // ‼️ What gets saved must match what `proceed` is about to destroy. Saving every
  // dirty tab for a one-context close would write files in folders the user never
  // touched; saving only the active tab for a whole-surface close loses the rest.
  const runSave = async (): Promise<boolean> => {
    if (unsavedModal.intent === "closeTab") {
      if (!tab) return true;
      return saveDirtyTab(
        tab,
        useEditorStore.getState().activeTabId,
        deps.handleSave,
      );
    }
    if (unsavedModal.intent === "closeContext") {
      return saveDirtyTabsForContexts(unsavedModal.contextIds, deps);
    }
    return saveAllDirtyForQuit(deps);
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

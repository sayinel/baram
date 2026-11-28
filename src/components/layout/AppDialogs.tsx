// §4.2 App's dialog/overlay host — every lazy dialog and modal that floats
// above the 3-column layout, plus the conflict-merge flow that owns its own
// local state.
import { lazy, Suspense, useState } from "react";

import type { MergeResult } from "../../ipc/types";
import type { Editor } from "@tiptap/react";

import { useShallow } from "zustand/shallow";

import { shouldDeferSave } from "../../hooks/use-auto-save";
import { reloadAfterConflictConsent } from "../../hooks/use-file-operations";
import { useTranslation } from "../../i18n/useTranslation";
import { readFile } from "../../ipc/invoke";
import { mergeTexts } from "../../ipc/snapshot";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import {
  applyConflictMerge,
  conflictLocalText,
  mergeBaseOf,
  mergeWithoutBase,
  noteDiskTextFromRead,
} from "../../utils/editor/conflict-merge";
import { logger } from "../../utils/logger";
import { basename } from "../../utils/path-utils";
import { SmartTemplateDialogWrapper } from "../ai/SmartTemplateDialogWrapper";
import { UnsavedChangesModal } from "../editor/UnsavedChangesModal";

const CommandPalette = lazy(() =>
  import("../command/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  })),
);
const ExportDialog = lazy(() =>
  import("../export/ExportDialog").then((m) => ({
    default: m.ExportDialog,
  })),
);
const QuickSwitcher = lazy(() =>
  import("../command/QuickSwitcher").then((m) => ({
    default: m.QuickSwitcher,
  })),
);
const HoverPreview = lazy(() =>
  import("../editor/HoverPreview").then((m) => ({
    default: m.HoverPreview,
  })),
);
const SettingsModal = lazy(() =>
  import("../settings/SettingsModal").then((m) => ({
    default: m.SettingsModal,
  })),
);
const AboutModal = lazy(() =>
  import("../settings/AboutModal").then((m) => ({
    default: m.AboutModal,
  })),
);
const UpdateDialog = lazy(() =>
  import("../settings/UpdateDialog").then((m) => ({
    default: m.UpdateDialog,
  })),
);
const SkillGeneratorDialog = lazy(() =>
  import("../ai/SkillGeneratorDialog").then((m) => ({
    default: m.SkillGeneratorDialog,
  })),
);
const SkillTestDialog = lazy(() =>
  import("../ai/SkillTestDialog").then((m) => ({
    default: m.SkillTestDialog,
  })),
);
const TaskEditDialog = lazy(() =>
  import("../tasks/TaskEditDialog").then((m) => ({
    default: m.TaskEditDialog,
  })),
);
const WeeklyReviewDialog = lazy(() =>
  import("../tasks/WeeklyReviewDialog").then((m) => ({
    default: m.WeeklyReviewDialog,
  })),
);
const QuickCaptureDialog = lazy(() =>
  import("../journal/QuickCaptureDialog").then((m) => ({
    default: m.QuickCaptureDialog,
  })),
);
const ZettelTitleDialog = lazy(() =>
  import("../journal/ZettelTitleDialog").then((m) => ({
    default: m.ZettelTitleDialog,
  })),
);
const ConflictModalWrapper = lazy(() =>
  import("../editor/ConflictModal").then((m) => ({
    default: m.ConflictModalWrapper,
  })),
);
const ToastHost = lazy(() =>
  import("../editor/Toast").then((m) => ({
    default: m.ToastHost,
  })),
);
const MergeView = lazy(() =>
  import("../editor/MergeView").then((m) => ({
    default: m.MergeView,
  })),
);

interface AppDialogsProps {
  activeEditor: Editor | null;
  handleCloseFolder: () => void;
  handleNewFile: () => void;
  handleNewNamedFile: (name: string) => void;
  handleOpenFile: () => void;
  handleOpenFolder: () => void;
  handleSave: () => Promise<void>;
  handleSkillPreviewToggle: () => void;
  handleToggleSourceMode: () => void;
}

function SkillGeneratorDialogWrapper() {
  const { skillGeneratorDialogOpen, toggleSkillGeneratorDialog } = useUIStore(
    useShallow((s) => ({
      skillGeneratorDialogOpen: s.skillGeneratorDialogOpen,
      toggleSkillGeneratorDialog: s.toggleSkillGeneratorDialog,
    })),
  );
  return (
    <SkillGeneratorDialog
      onClose={toggleSkillGeneratorDialog}
      open={skillGeneratorDialogOpen}
    />
  );
}

function SkillTestDialogWrapper() {
  const { skillTestDialogOpen, toggleSkillTestDialog } = useUIStore(
    useShallow((s) => ({
      skillTestDialogOpen: s.skillTestDialogOpen,
      toggleSkillTestDialog: s.toggleSkillTestDialog,
    })),
  );
  return (
    <SkillTestDialog
      onClose={toggleSkillTestDialog}
      open={skillTestDialogOpen}
    />
  );
}

/**
 * §3.6 Brings the conflict modal back for `filePath` after a merge that did not happen — it could not
 * start, it was cancelled, or its write failed. Until the conflict is answered the file's saves stay
 * held off (`shouldDeferSave`), and with no modal there is no way to answer it. Nothing to ask when no
 * tab shows the file any more, or when the conflict was answered meanwhile. The modal shows one
 * conflict: if this file's is already on screen it covers this one, and another file's is answered
 * first, then this one is asked. The base and mtime are read now — a "Keep Local Edits" or another change in
 * between moved them.
 */
function askAboutConflictAgain(filePath: string): void {
  if (!useEditorStore.getState().tabs.some((t) => t.filePath === filePath)) {
    return;
  }
  const entry = useFileStore.getState().getFileMtime(filePath);
  if (!entry || !shouldDeferSave(entry)) return;
  const shown = useUIStore.getState().conflictModal;
  if (shown !== null) {
    if (shown.filePath === filePath) return;
    const unsubscribe = useUIStore.subscribe((state) => {
      if (state.conflictModal !== null) return;
      unsubscribe();
      askAboutConflictAgain(filePath);
    });
    return;
  }
  useUIStore
    .getState()
    .openConflictModal(filePath, entry.canReloadMtime, mergeBaseOf(filePath));
}

/** §4.2 Dialog/overlay host — CommandPalette, every lazy modal, the conflict
 * banner, and the merge view. Rendered inside `<EditorContext>` at the same
 * tree position as before this was extracted (see App.tsx render). */
export function AppDialogs({
  activeEditor,
  handleCloseFolder,
  handleNewFile,
  handleNewNamedFile,
  handleOpenFile,
  handleOpenFolder,
  handleSave,
  handleSkillPreviewToggle,
  handleToggleSourceMode,
}: AppDialogsProps) {
  const { t } = useTranslation();
  // §3.6 The merge view's state, with what the conflict modal needs to come back if it is left.
  const [mergeState, setMergeState] = useState<
    | (MergeResult & {
        externalMtime: number;
        filePath: string;
      })
    | null
  >(null);

  return (
    <Suspense fallback={null}>
      <CommandPalette
        editor={activeEditor}
        onCloseFolder={handleCloseFolder}
        onNewFile={handleNewFile}
        onOpenFile={handleOpenFile}
        onOpenFolder={handleOpenFolder}
        onSave={handleSave}
        onSkillPreview={handleSkillPreviewToggle}
        onToggleSourceMode={handleToggleSourceMode}
      />
      <ExportDialog editor={activeEditor} />
      <QuickSwitcher editor={activeEditor} onNewFile={handleNewNamedFile} />
      <SettingsModal />
      <AboutModal />
      <UpdateDialog />
      <UnsavedChangesModal handleSave={handleSave} />
      <HoverPreview />
      <SkillGeneratorDialogWrapper />
      <SkillTestDialogWrapper />
      <SmartTemplateDialogWrapper editor={activeEditor} />
      <QuickCaptureDialog />
      <WeeklyReviewDialog />
      <TaskEditDialog />
      <ZettelTitleDialog />
      <ConflictModalWrapper
        onKeepLocal={(filePath) => {
          // Keep local edits: clear the mtime guard so the next save (and the
          // immediate save below) overwrites the external change on disk.
          const entry = useFileStore.getState().getFileMtime(filePath);
          useFileStore
            .getState()
            .updateLastSaveMtime(filePath, entry?.canReloadMtime ?? 0, null);
          // If the conflicted file is the active tab, persist local edits now so
          // they aren't lost if the user doesn't edit again before quitting.
          const { activeTabId, tabs } = useEditorStore.getState();
          const activeTab = tabs.find((t) => t.id === activeTabId);
          // §3.6 Until that save the disk holds the other program's text, which the user chose to
          // keep their edits over. A later merge starts from it, or it would bring back what was
          // just declined. Read before the save, so the save's record of what it wrote comes last.
          void (async () => {
            await noteDiskTextFromRead(filePath, entry?.canReloadMtime ?? 0);
            if (activeTab?.filePath === filePath) await handleSave();
          })();
        }}
        onMerge={async (filePath, base, externalMtime) => {
          try {
            // §3.6 The tab that shows the file, wherever it is — not the active editor's document.
            const local = conflictLocalText(filePath, activeEditor);
            if (local === null) throw new Error("no text to merge");
            // Not recorded as the disk text here: until the merge is applied the tab's text does not
            // descend from it, and a merge left now would leave a base its lines seem to take back.
            const external = await readFile(filePath);
            const merge =
              base !== null
                ? await mergeTexts(base, local, external)
                : mergeWithoutBase(local, external);
            setMergeState({ ...merge, externalMtime, filePath });
          } catch (err) {
            logger.warn("[conflict] the merge could not start", err);
            useUIStore
              .getState()
              .showToast(
                t("conflict.mergeUnavailable", { name: basename(filePath) }),
                "warning",
              );
            askAboutConflictAgain(filePath);
          }
        }}
        // §312 왜 force가 필요한지는 reloadAfterConflictConsent의 주석 참조.
        onReload={reloadAfterConflictConsent}
      />
      <ToastHost />
      {mergeState && (
        <MergeView
          filePath={mergeState.filePath}
          merge={mergeState}
          onApply={(merged) => {
            const { externalMtime, filePath } = mergeState;
            setMergeState(null);
            // §3.6 Changed again while the merge view was open: writing this merge would drop that
            // change. Ask about the newer text instead.
            const entry = useFileStore.getState().getFileMtime(filePath);
            if (entry && entry.canReloadMtime > externalMtime) {
              useUIStore
                .getState()
                .showToast(
                  t("conflict.mergeUnavailable", { name: basename(filePath) }),
                  "warning",
                );
              askAboutConflictAgain(filePath);
              return;
            }
            // §3.6 Into the tab that shows the file; no other tab is touched.
            applyConflictMerge(filePath, merged).catch((err) => {
              logger.error("[App] merge apply failed", err);
              useUIStore
                .getState()
                .showToast(
                  t("conflict.mergeFailed", { name: basename(filePath) }),
                  "error",
                );
              askAboutConflictAgain(filePath);
            });
          }}
          onCancel={() => {
            const { filePath } = mergeState;
            setMergeState(null);
            // §3.6 The conflict is still there: ask again rather than leave its saves held.
            askAboutConflictAgain(filePath);
          }}
        />
      )}
    </Suspense>
  );
}

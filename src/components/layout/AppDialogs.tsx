// §4.2 App's dialog/overlay host — every lazy dialog and modal that floats
// above the 3-column layout, plus the conflict-merge flow that owns its own
// local state.
import { lazy, Suspense, useState } from "react";

import type { MergeSegment } from "../../ipc/types";
import type { Editor } from "@tiptap/react";

import { useShallow } from "zustand/shallow";

import { reloadAfterConflictConsent } from "../../hooks/use-file-operations";
import { readFile, writeFile } from "../../ipc/invoke";
import { mergeTexts } from "../../ipc/snapshot";
import { useEditorStore } from "../../stores/editor/editor";
import { useSnapshotStore } from "../../stores/editor/snapshot";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { logger } from "../../utils/logger";
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
  handleOpenFile: () => void;
  handleOpenFolder: () => void;
  handleSave: () => Promise<void>;
  handleSkillPreviewToggle: () => void;
  handleToggleSourceMode: () => void;
  markDirty: (tabId: string, dirty: boolean) => void;
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

/** §4.2 Dialog/overlay host — CommandPalette, every lazy modal, the conflict
 * banner, and the merge view. Rendered inside `<EditorProvider>` at the same
 * tree position as before this was extracted (see App.tsx render). */
export function AppDialogs({
  activeEditor,
  handleCloseFolder,
  handleNewFile,
  handleOpenFile,
  handleOpenFolder,
  handleSave,
  handleSkillPreviewToggle,
  handleToggleSourceMode,
  markDirty,
}: AppDialogsProps) {
  // §39 Tab switcher state
  const [mergeState, setMergeState] = useState<null | {
    filePath: string;
    segments: MergeSegment[];
  }>(null);

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
      <QuickSwitcher editor={activeEditor} onNewFile={handleNewFile} />
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
            .updateLastSaveMtime(filePath, entry?.canReloadMtime ?? 0);
          // If the conflicted file is the active tab, persist local edits now so
          // they aren't lost if the user doesn't edit again before quitting.
          const { activeTabId, tabs } = useEditorStore.getState();
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab?.filePath === filePath) void handleSave();
        }}
        onMerge={async (filePath, base) => {
          if (!activeEditor || activeEditor.isDestroyed) return;
          const local = serializeLiveDoc(activeEditor);
          const external = await readFile(filePath);
          const result = await mergeTexts(base, local, external);
          setMergeState({ filePath, segments: result.segments });
        }}
        // §312 왜 force가 필요한지는 reloadAfterConflictConsent의 주석 참조.
        onReload={reloadAfterConflictConsent}
      />
      <ToastHost />
      {mergeState && (
        <MergeView
          filePath={mergeState.filePath}
          onApply={(merged) => {
            const fp = mergeState.filePath;
            void (async () => {
              try {
                await writeFile(fp, merged);
                useFileStore.getState().setFileContent(fp, merged);
                useFileStore.getState().updateLastSaveMtime(fp, Date.now());
                useEditorStore.getState().requestContentRefresh();
                const { activeTabId: tid } = useEditorStore.getState();
                if (tid) markDirty(tid, false);
                // §71 A conflict-merge write is a real content change.
                useSnapshotStore.getState().markPendingAutoSnapshot();
              } catch (err) {
                logger.error("[App] merge apply failed", err);
              }
            })();
            setMergeState(null);
          }}
          onCancel={() => setMergeState(null)}
          segments={mergeState.segments}
        />
      )}
    </Suspense>
  );
}

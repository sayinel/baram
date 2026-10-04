// §4.2 App's dialog/overlay host — every lazy dialog and modal that floats
// above the 3-column layout, plus the conflict-merge flow that owns its own
// local state.
import { lazy, Suspense } from "react";

import type { Editor } from "@tiptap/react";

import { useShallow } from "zustand/shallow";

import { useUIStore } from "../../stores/ui/ui";
import { SmartTemplateDialogWrapper } from "../ai/SmartTemplateDialogWrapper";
import { UnsavedChangesModal } from "../editor/UnsavedChangesModal";
import { useConflictActions } from "./use-conflict-actions";

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
 * banner, and the merge view. Rendered inside `<EditorContext>` at the same
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
}: AppDialogsProps) {
  const conflict = useConflictActions();

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
        onKeepLocal={conflict.onKeepLocal}
        onMerge={conflict.onMerge}
        onReload={conflict.onReload}
        pending={conflict.pending}
        suspended={conflict.merge !== null}
      />
      <ToastHost />
      {conflict.merge && (
        <MergeView
          busy={conflict.mergeBusy}
          filePath={conflict.merge.path}
          onApply={conflict.onApply}
          onCancel={conflict.onCancelMerge}
          segments={conflict.merge.segments}
        />
      )}
    </Suspense>
  );
}

// §54 워크스페이스 프리스펙티브 갤러리 — 저장된 레이아웃 카드와 그 저장 폼.
//
// AppearanceTab에서 나왔다(그 파일이 516줄이었다). 로직은 옮기기 전과 같다.
import { useCallback, useState } from "react";

import type { WorkspacePreset } from "../../../stores/file/workspace";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import {
  BUILTIN_PRESETS,
  isPresetVisible,
  presetDisplayDescription,
  presetDisplayName,
  useWorkspaceStore,
} from "../../../stores/file/workspace";
import { useFeatureFlags } from "../../../stores/settings/features";
import { showConfirm } from "../../../utils/confirm-dialog";

export function WorkspacePresets() {
  const { t } = useTranslation();
  const {
    activePresetId,
    customPresets,
    applyPreset,
    saveCustomPreset,
    deleteCustomPreset,
  } = useWorkspaceStore(
    useShallow((s) => ({
      activePresetId: s.activePresetId,
      customPresets: s.customPresets,
      applyPreset: s.applyPreset,
      saveCustomPreset: s.saveCustomPreset,
      deleteCustomPreset: s.deleteCustomPreset,
    })),
  );

  const [savingNew, setSavingNew] = useState(false);
  const [newName, setNewName] = useState("");

  const featureFlags = useFeatureFlags();
  // §338/I-8 — customPresets are never filtered: they are user-made, and
  // `applyPreset` only branches on PRESET_FEATURE's own ids, so a custom
  // preset id is never subject to this gate in the first place.
  const allPresets = [
    ...BUILTIN_PRESETS.filter((preset) =>
      isPresetVisible(preset.id, featureFlags),
    ),
    ...customPresets,
  ];

  const handleApply = useCallback(
    (id: string) => {
      applyPreset(id);
    },
    [applyPreset],
  );

  // issue 523: a saved layout is persisted data with no undo — ask first.
  const handleDelete = useCallback(
    async (id: string) => {
      const name = customPresets.find((p) => p.id === id)?.name ?? id;
      const confirmed = await showConfirm(
        t("settings.workspace.deletePresetConfirm", { name }),
        {
          cancelLabel: t("common.cancel"),
          confirmLabel: t("common.delete"),
        },
      );
      if (confirmed) deleteCustomPreset(id);
    },
    [customPresets, deleteCustomPreset, t],
  );

  const handleSave = useCallback(() => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    saveCustomPreset(trimmed);
    setNewName("");
    setSavingNew(false);
  }, [newName, saveCustomPreset]);

  const handleSaveKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        handleSave();
      } else if (e.key === "Escape") {
        setNewName("");
        setSavingNew(false);
      }
    },
    [handleSave],
  );

  return (
    <>
      <div className="workspace-gallery">
        {allPresets.map((preset) => (
          <PresetCard
            isActive={activePresetId === preset.id}
            key={preset.id}
            onApply={handleApply}
            onDelete={!preset.builtIn ? handleDelete : undefined}
            preset={preset}
          />
        ))}
      </div>

      <div className="workspace-actions">
        {savingNew ? (
          <div className="workspace-save-form">
            <input
              autoFocus
              className="workspace-save-input"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleSaveKeyDown}
              placeholder={t("settings.workspace.presetName")}
              type="text"
              value={newName}
            />
            <button
              className="workspace-save-confirm"
              disabled={!newName.trim()}
              onClick={handleSave}
            >
              {t("common.save")}
            </button>
            <button
              className="workspace-save-cancel"
              onClick={() => {
                setNewName("");
                setSavingNew(false);
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        ) : (
          <button
            className="workspace-action-btn"
            onClick={() => setSavingNew(true)}
          >
            {t("settings.appearance.saveCurrentLayout")}
          </button>
        )}
      </div>
    </>
  );
}

// ─── Layout Diagram ─────────────────────────────────────

function LayoutDiagram({ preset }: { preset: WorkspacePreset }) {
  const { layout } = preset;
  return (
    <div className="workspace-diagram">
      {layout.sidebarOpen && (
        <div className="workspace-diagram-panel workspace-diagram-sidebar" />
      )}
      <div className="workspace-diagram-panel workspace-diagram-editor" />
      {layout.rightPanelOpen && layout.rightPanelMode !== "none" && (
        <div className="workspace-diagram-panel workspace-diagram-right" />
      )}
    </div>
  );
}

// ─── Preset Card ────────────────────────────────────────

function PresetCard({
  preset,
  isActive,
  onApply,
  onDelete,
}: {
  isActive: boolean;
  onApply: (id: string) => void;
  onDelete?: (id: string) => void;
  preset: WorkspacePreset;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`workspace-card ${isActive ? "workspace-card-active" : ""}`}
      onClick={() => onApply(preset.id)}
    >
      {isActive && (
        <span aria-label="Active" className="workspace-card-check">
          &#10003;
        </span>
      )}
      {onDelete && (
        <button
          className="workspace-card-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(preset.id);
          }}
          title={t("settings.workspace.deletePreset")}
        >
          {"×"}
        </button>
      )}

      <div className="workspace-card-layout">
        <LayoutDiagram preset={preset} />
      </div>

      <span className="workspace-card-name">
        {presetDisplayName(preset, t)}
      </span>
      {preset.description && (
        <span className="workspace-card-desc">
          {presetDisplayDescription(preset, t)}
        </span>
      )}
      <span className="workspace-card-summary">
        {workspaceLayoutSummary(preset, t)}
      </span>

      {preset.builtIn && (
        <span className="workspace-card-badge">
          {t("settings.workspace.builtIn")}
        </span>
      )}
    </div>
  );
}

// ─── Workspace Layout Summary ───────────────────────────

function workspaceLayoutSummary(
  preset: WorkspacePreset,
  t: (key: string) => string,
): string {
  const panelKey = `settings.panels.${preset.layout.sidebarPanel}`;
  const parts: string[] = [];
  if (preset.layout.sidebarOpen) {
    parts.push(t(panelKey));
  }
  parts.push(t("settings.workspace.editor"));
  if (preset.layout.rightPanelOpen && preset.layout.rightPanelMode !== "none") {
    parts.push(t(`settings.panels.${preset.layout.rightPanelMode}`));
  }
  return parts.join(" + ");
}

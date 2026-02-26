// §52 WorkspaceTab — Workspace Presets settings panel
// Card grid for built-in and custom presets with save/delete/apply actions
import { useState, useCallback } from "react";
import { useWorkspaceStore, BUILTIN_PRESETS } from "../../stores/workspace-store";
import type { WorkspacePreset } from "../../stores/workspace-store";

// Layout label helpers
const SIDEBAR_PANEL_LABELS: Record<string, string> = {
  files: "Files",
  outline: "Outline",
  search: "Search",
  backlinks: "Backlinks",
  bookmarks: "Bookmarks",
  graph: "Graph",
  git: "Git",
};

const RIGHT_PANEL_LABELS: Record<string, string> = {
  chat: "AI Chat",
  help: "Help",
  none: "None",
};

function layoutSummary(preset: WorkspacePreset): string {
  const parts: string[] = [];
  if (preset.layout.sidebarOpen) {
    parts.push(SIDEBAR_PANEL_LABELS[preset.layout.sidebarPanel] ?? preset.layout.sidebarPanel);
  }
  parts.push("Editor");
  if (preset.layout.rightPanelOpen && preset.layout.rightPanelMode !== "none") {
    parts.push(RIGHT_PANEL_LABELS[preset.layout.rightPanelMode] ?? preset.layout.rightPanelMode);
  }
  return parts.join(" + ");
}

export function WorkspaceTab() {
  const { activePresetId, customPresets, applyPreset, saveCustomPreset, deleteCustomPreset } =
    useWorkspaceStore();

  const [savingNew, setSavingNew] = useState(false);
  const [newName, setNewName] = useState("");

  const allPresets = [...BUILTIN_PRESETS, ...customPresets];

  const handleApply = useCallback(
    (id: string) => {
      applyPreset(id);
    },
    [applyPreset],
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
    <div className="settings-section">
      <div className="settings-section-header">Presets</div>

      <div className="workspace-gallery">
        {allPresets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            isActive={activePresetId === preset.id}
            onApply={handleApply}
            onDelete={!preset.builtIn ? deleteCustomPreset : undefined}
          />
        ))}
      </div>

      <div className="workspace-actions">
        {savingNew ? (
          <div className="workspace-save-form">
            <input
              type="text"
              className="workspace-save-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleSaveKeyDown}
              placeholder="Preset name..."
              autoFocus
            />
            <button
              className="workspace-save-confirm"
              onClick={handleSave}
              disabled={!newName.trim()}
            >
              Save
            </button>
            <button
              className="workspace-save-cancel"
              onClick={() => {
                setNewName("");
                setSavingNew(false);
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button className="workspace-action-btn" onClick={() => setSavingNew(true)}>
            Save Current Layout...
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Preset Card ──────────────────────────────────────────

function PresetCard({
  preset,
  isActive,
  onApply,
  onDelete,
}: {
  preset: WorkspacePreset;
  isActive: boolean;
  onApply: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  return (
    <div
      className={`workspace-card ${isActive ? "workspace-card-active" : ""}`}
      onClick={() => onApply(preset.id)}
    >
      {isActive && <span className="workspace-card-check" aria-label="Active">&#10003;</span>}
      {onDelete && (
        <button
          className="workspace-card-delete"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(preset.id);
          }}
          title="Delete preset"
        >
          {"\u00D7"}
        </button>
      )}

      <div className="workspace-card-layout">
        <LayoutDiagram preset={preset} />
      </div>

      <span className="workspace-card-name">{preset.name}</span>
      {preset.description && (
        <span className="workspace-card-desc">{preset.description}</span>
      )}
      <span className="workspace-card-summary">{layoutSummary(preset)}</span>

      {preset.builtIn && <span className="workspace-card-badge">Built-in</span>}
    </div>
  );
}

// ─── Layout Diagram ───────────────────────────────────────

function LayoutDiagram({ preset }: { preset: WorkspacePreset }) {
  const { layout } = preset;
  return (
    <div className="workspace-diagram">
      {layout.sidebarOpen && <div className="workspace-diagram-panel workspace-diagram-sidebar" />}
      <div className="workspace-diagram-panel workspace-diagram-editor" />
      {layout.rightPanelOpen && layout.rightPanelMode !== "none" && (
        <div className="workspace-diagram-panel workspace-diagram-right" />
      )}
    </div>
  );
}

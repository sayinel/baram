// §86 Vault (Contexts) settings tab
import { useCallback, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import { Folder, Trash2 } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useContextStore } from "../../../stores/context/context";
import { addFolder } from "../../../stores/file/file";
import { logger } from "../../../utils/logger";

const PRESET_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

export function VaultTab() {
  const { contexts, removeContext, updateContextLabel, updateContextColor } =
    useContextStore(
      useShallow((s) => ({
        contexts: s.contexts,
        removeContext: s.removeContext,
        updateContextLabel: s.updateContextLabel,
        updateContextColor: s.updateContextColor,
      })),
    );

  const handleAddFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (selected) {
        await addFolder(selected as string);
      }
    } catch (err) {
      logger.error("[VaultTab] addFolder failed:", err);
    }
  }, []);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">Contexts</h3>
      <p className="settings-section-desc">
        Manage open vaults, folders, and files.
      </p>

      <div className="vault-tab-list">
        {contexts.length === 0 ? (
          <p className="vault-tab-empty">
            No contexts open. Click "Add Folder" to get started.
          </p>
        ) : (
          contexts.map((ctx) => (
            <VaultTabItem
              context={ctx}
              key={ctx.id}
              onColorChange={(color) => updateContextColor(ctx.id, color)}
              onLabelChange={(label) => updateContextLabel(ctx.id, label)}
              onRemove={() => removeContext(ctx.id)}
            />
          ))
        )}
      </div>

      <div className="vault-tab-actions">
        <button className="vault-tab-add-btn" onClick={handleAddFolder}>
          <Folder size={14} />
          Add Folder…
        </button>
      </div>
    </div>
  );
}

function VaultTabItem({
  context,
  onRemove,
  onLabelChange,
  onColorChange,
}: {
  context: {
    color: string;
    contextType: string;
    id: string;
    label: string;
    path: string;
    vaultType?: string;
  };
  onColorChange: (color: string) => void;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const typeLabel =
    context.vaultType === "journal"
      ? "Journal"
      : context.contextType === "vault"
        ? "Vault"
        : context.contextType === "folder"
          ? "Folder"
          : "File";

  return (
    <div className="vault-tab-item">
      <button
        className="vault-tab-item__color"
        onClick={() => setShowColors((v) => !v)}
        style={{ backgroundColor: context.color }}
        title="Change color"
      />
      <div className="vault-tab-item__info">
        {editing ? (
          <input
            autoFocus
            className="vault-tab-item__name-input"
            defaultValue={context.label}
            onBlur={(e) => {
              onLabelChange(e.currentTarget.value.trim() || context.label);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onLabelChange(e.currentTarget.value.trim() || context.label);
                setEditing(false);
              }
              if (e.key === "Escape") setEditing(false);
            }}
            ref={inputRef}
          />
        ) : (
          <span
            className="vault-tab-item__name"
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename"
          >
            {context.label}
          </span>
        )}
        <span className="vault-tab-item__meta">
          {typeLabel} · {context.path}
        </span>
      </div>
      <button
        className="vault-tab-item__remove icon-btn"
        onClick={onRemove}
        title="Remove context"
      >
        <Trash2 size={14} />
      </button>

      {showColors && (
        <div className="vault-tab-item__color-picker">
          {PRESET_COLORS.map((c) => (
            <button
              className="vault-tab-item__color-swatch"
              key={c}
              onClick={() => {
                onColorChange(c);
                setShowColors(false);
              }}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

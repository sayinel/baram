// §86 Vault (Contexts) settings tab
import { useCallback, useEffect, useRef, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { VaultConfig } from "../../../ipc/types";

import { Folder, Trash2 } from "lucide-react";
import { useShallow } from "zustand/shallow";

import {
  getVaultConfigByPath,
  setVaultConfigByPath,
} from "../../../ipc/context";
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

// ── Vault extension list ────────────────────────────────────────────────────

const VAULT_EXTENSIONS = [
  { extId: "ext-wikilink", name: "Wikilinks" },
  { extId: "ext-mermaid", name: "Mermaid" },
  { extId: "ext-skills", name: "Skills" },
  { extId: "ext-journal", name: "Journal" },
  { extId: "ext-math", name: "Math" },
] as const;

// ── Helper components ───────────────────────────────────────────────────────

export function VaultTab() {
  const {
    contexts,
    activeContextId,
    removeContext,
    updateContextAlias,
    updateContextLabel,
    updateContextColor,
  } = useContextStore(
    useShallow((s) => ({
      contexts: s.contexts,
      activeContextId: s.activeContextId,
      removeContext: s.removeContext,
      updateContextAlias: s.updateContextAlias,
      updateContextLabel: s.updateContextLabel,
      updateContextColor: s.updateContextColor,
    })),
  );

  const [selectedContextId, setSelectedContextId] = useState<null | string>(
    activeContextId,
  );

  // The context whose settings are shown — vault or folder (not standalone file)
  const selectedContext =
    contexts.find(
      (c) => c.id === selectedContextId && c.contextType !== "file",
    ) ?? null;

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
              isSelected={ctx.id === selectedContextId}
              key={ctx.id}
              onAliasChange={(alias) => updateContextAlias(ctx.id, alias)}
              onColorChange={(color) => updateContextColor(ctx.id, color)}
              onLabelChange={(label) => updateContextLabel(ctx.id, label)}
              onRemove={() => removeContext(ctx.id)}
              onSelect={() => setSelectedContextId(ctx.id)}
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

      {selectedContext && selectedContext.contextType === "vault" && (
        <VaultSettingsSection contextPath={selectedContext.path} />
      )}
      {selectedContext && selectedContext.contextType === "folder" && (
        <p className="settings-section-desc">
          This is a plain folder. Use &ldquo;Initialize as Vault&rdquo; from the
          + menu to enable per-folder settings.
        </p>
      )}
    </div>
  );
}

function SelectSetting({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
  value: string | undefined;
}) {
  return (
    <div className="vault-settings-row">
      <span className="vault-settings-row__label">{label}</span>
      <select
        className="vault-settings-select"
        onChange={(e) => onChange(e.currentTarget.value)}
        value={value ?? ""}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextSetting({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  onChange: (v: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <div className="vault-settings-row">
      <span className="vault-settings-row__label">{label}</span>
      <input
        className="vault-settings-input"
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </div>
  );
}

/** 3-state toggle: undefined = Default, true = On, false = Off */
function ThreeStateToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  onChange: (v: boolean | undefined) => void;
  value: boolean | undefined;
}) {
  return (
    <div className="vault-settings-row">
      <span className="vault-settings-row__label">{label}</span>
      <div className="vault-settings-row__control">
        <button
          className={`vault-three-state-btn ${value === undefined ? "vault-three-state-btn--active" : ""}`}
          onClick={() => onChange(undefined)}
          type="button"
        >
          Default
        </button>
        <button
          className={`vault-three-state-btn ${value === true ? "vault-three-state-btn--active" : ""}`}
          onClick={() => onChange(true)}
          type="button"
        >
          On
        </button>
        <button
          className={`vault-three-state-btn ${value === false ? "vault-three-state-btn--active" : ""}`}
          onClick={() => onChange(false)}
          type="button"
        >
          Off
        </button>
      </div>
    </div>
  );
}

// ── VaultSettingsSection ────────────────────────────────────────────────────

function VaultExtensionToggle({
  config,
  extId,
  name,
  onSave,
}: {
  config: VaultConfig;
  extId: string;
  name: string;
  onSave: (updated: VaultConfig) => void;
}) {
  const enabled = config.extensions?.enabled ?? [];
  const disabled = config.extensions?.disabled ?? [];

  let state: "default" | "disabled" | "enabled" = "default";
  if (enabled.includes(extId)) state = "enabled";
  else if (disabled.includes(extId)) state = "disabled";

  const handleChange = (next: "default" | "disabled" | "enabled") => {
    const newEnabled = enabled.filter((id) => id !== extId);
    const newDisabled = disabled.filter((id) => id !== extId);
    if (next === "enabled") newEnabled.push(extId);
    else if (next === "disabled") newDisabled.push(extId);

    onSave({
      ...config,
      extensions: {
        ...config.extensions,
        enabled: newEnabled.length ? newEnabled : undefined,
        disabled: newDisabled.length ? newDisabled : undefined,
      },
    });
  };

  return (
    <div className="vault-settings-row">
      <span className="vault-settings-row__label">{name}</span>
      <div className="vault-settings-row__control">
        <button
          className={`vault-three-state-btn ${state === "default" ? "vault-three-state-btn--active" : ""}`}
          onClick={() => handleChange("default")}
          type="button"
        >
          Default
        </button>
        <button
          className={`vault-three-state-btn ${state === "enabled" ? "vault-three-state-btn--active" : ""}`}
          onClick={() => handleChange("enabled")}
          type="button"
        >
          Enabled
        </button>
        <button
          className={`vault-three-state-btn ${state === "disabled" ? "vault-three-state-btn--active" : ""}`}
          onClick={() => handleChange("disabled")}
          type="button"
        >
          Disabled
        </button>
      </div>
    </div>
  );
}

// ── VaultTab ────────────────────────────────────────────────────────────────

function VaultSettingsSection({ contextPath }: { contextPath: string }) {
  const [config, setConfig] = useState<null | VaultConfig>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getVaultConfigByPath(contextPath)
      .then((c) => setConfig(c ?? {}))
      .catch(() => setConfig({}))
      .finally(() => setLoading(false));
  }, [contextPath]);

  const saveConfig = useCallback(
    async (updated: VaultConfig) => {
      setConfig(updated);
      try {
        await setVaultConfigByPath(contextPath, updated);
      } catch (err) {
        logger.error("[VaultSettings] save failed:", err);
      }
    },
    [contextPath],
  );

  if (loading) return <p className="vault-settings-loading">Loading…</p>;
  if (!config) return null;

  const bulletMarker =
    (config.markdown?.serializationRules?.bulletListMarker as string) ?? "";

  return (
    <>
      <h3 className="settings-section-title" style={{ marginTop: 24 }}>
        Vault Settings Override
      </h3>
      <p className="settings-section-desc">
        These settings override global defaults for this vault only.
      </p>

      {/* Extensions */}
      <div className="vault-settings-group">
        <h4 className="vault-settings-group__title">Extensions</h4>
        {VAULT_EXTENSIONS.map(({ extId, name }) => (
          <VaultExtensionToggle
            config={config}
            extId={extId}
            key={extId}
            name={name}
            onSave={saveConfig}
          />
        ))}
      </div>

      {/* Markdown */}
      <div className="vault-settings-group">
        <h4 className="vault-settings-group__title">Markdown</h4>
        <ThreeStateToggle
          label="Wikilinks"
          onChange={(v) =>
            saveConfig({
              ...config,
              markdown: { ...config.markdown, enableWikilink: v },
            })
          }
          value={config.markdown?.enableWikilink}
        />
        <ThreeStateToggle
          label="Mermaid Diagrams"
          onChange={(v) =>
            saveConfig({
              ...config,
              markdown: { ...config.markdown, enableMermaid: v },
            })
          }
          value={config.markdown?.enableMermaid}
        />
        <SelectSetting
          label="Bullet List Marker"
          onChange={(v) =>
            saveConfig({
              ...config,
              markdown: {
                ...config.markdown,
                serializationRules: v
                  ? {
                      ...config.markdown?.serializationRules,
                      bulletListMarker: v,
                    }
                  : undefined,
              },
            })
          }
          options={[
            { label: "Default (global)", value: "" },
            { label: "- (dash)", value: "-" },
            { label: "* (asterisk)", value: "*" },
            { label: "+ (plus)", value: "+" },
          ]}
          value={bulletMarker}
        />
      </div>

      {/* AI */}
      <div className="vault-settings-group">
        <h4 className="vault-settings-group__title">AI</h4>
        <TextSetting
          label="Model Override"
          onChange={(v) =>
            saveConfig({
              ...config,
              ai: { ...config.ai, model: v || undefined },
            })
          }
          placeholder="Default (global)"
          value={config.ai?.model ?? ""}
        />
        <ThreeStateToggle
          label="Privacy Mode"
          onChange={(v) =>
            saveConfig({
              ...config,
              ai: { ...config.ai, privacyMode: v },
            })
          }
          value={config.ai?.privacyMode}
        />
      </div>

      {/* Work Log */}
      <div className="vault-settings-group">
        <h4 className="vault-settings-group__title">Work Log</h4>
        <ThreeStateToggle
          label="Enable Work Log"
          onChange={(v) =>
            saveConfig({
              ...config,
              workLog: { ...config.workLog, enabled: v },
            })
          }
          value={config.workLog?.enabled}
        />
        {config.workLog?.enabled && (
          <>
            <TextSetting
              label="Folder"
              onChange={(v) =>
                saveConfig({
                  ...config,
                  workLog: { ...config.workLog, folder: v || undefined },
                })
              }
              placeholder="daily"
              value={config.workLog?.folder ?? ""}
            />
            <TextSetting
              label="Template"
              onChange={(v) =>
                saveConfig({
                  ...config,
                  workLog: { ...config.workLog, template: v || undefined },
                })
              }
              placeholder="templates/work-log.md"
              value={config.workLog?.template ?? ""}
            />
          </>
        )}
      </div>
    </>
  );
}

// ── VaultTabItem ────────────────────────────────────────────────────────────

function VaultTabItem({
  context,
  isSelected,
  onRemove,
  onAliasChange,
  onLabelChange,
  onColorChange,
  onSelect,
}: {
  context: {
    alias?: string;
    color: string;
    contextType: string;
    id: string;
    label: string;
    path: string;
    vaultType?: string;
  };
  isSelected?: boolean;
  onAliasChange: (alias: string) => void;
  onColorChange: (color: string) => void;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
  onSelect?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);

  const typeLabel =
    context.vaultType === "journal"
      ? "Journal"
      : context.contextType === "vault"
        ? "Vault"
        : context.contextType === "folder"
          ? "Folder"
          : "File";

  return (
    <div
      className={`vault-tab-item ${isSelected ? "vault-tab-item--selected" : ""}`}
      onClick={onSelect}
    >
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
        {context.contextType === "vault" && (
          <span className="vault-tab-item__alias">
            {editingAlias ? (
              <input
                autoFocus
                className="vault-tab-item__alias-input"
                defaultValue={context.alias ?? ""}
                onBlur={(e) => {
                  onAliasChange(e.currentTarget.value.trim());
                  setEditingAlias(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onAliasChange(e.currentTarget.value.trim());
                    setEditingAlias(false);
                  }
                  if (e.key === "Escape") setEditingAlias(false);
                }}
                placeholder="alias"
                ref={aliasInputRef}
              />
            ) : (
              <span
                className="vault-tab-item__alias-value"
                onDoubleClick={() => setEditingAlias(true)}
                title="Double-click to edit alias"
              >
                alias: {context.alias || "(not set)"}
              </span>
            )}
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

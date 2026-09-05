// §86 Vault (Contexts) settings tab
import { useCallback, useEffect, useRef, useState } from "react";

import type { VaultConfig } from "../../../ipc/types";

import { Folder, X } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { requestCloseContexts } from "../../../hooks/use-close-guard";
import { useTranslation } from "../../../i18n/useTranslation";
import { pickApprovedDir } from "../../../ipc/approval";
import {
  getVaultConfigByPath,
  setVaultConfigByPath,
} from "../../../ipc/context";
import { convertContextType } from "../../../services/context-type-convert";
import { addFolder } from "../../../services/vault-context-loader";
import { useContextStore } from "../../../stores/context/context";
import { logger } from "../../../utils/logger";
import { ApprovedRootsSection } from "./ApprovedRootsSection";

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
  { extId: "ext-wikilink", labelKey: "settings.vault.extension.wikilink" },
  { extId: "ext-mermaid", labelKey: "settings.vault.extension.mermaid" },
  { extId: "ext-skills", labelKey: "settings.vault.extension.skills" },
  { extId: "ext-journal", labelKey: "settings.vault.extension.journal" },
  { extId: "ext-math", labelKey: "settings.vault.extension.math" },
] as const;

// ── Helper components ───────────────────────────────────────────────────────

export function VaultTab() {
  const { t } = useTranslation();
  const {
    contexts,
    activeContextId,
    updateContextAlias,
    updateContextLabel,
    updateContextColor,
  } = useContextStore(
    useShallow((s) => ({
      contexts: s.contexts,
      activeContextId: s.activeContextId,
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
      const selected = await pickApprovedDir("open-folder");
      if (selected) {
        await addFolder(selected);
      }
    } catch (err) {
      logger.error("[VaultTab] addFolder failed:", err);
    }
  }, []);

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t("settings.vault.contexts")}</h3>
      <p className="settings-section-desc">
        {t("settings.vault.contexts.desc")}
      </p>

      <div className="vault-tab-list">
        {contexts.length === 0 ? (
          <p className="vault-tab-empty">
            {t("settings.vault.contexts.empty")}
          </p>
        ) : (
          contexts.map((ctx) => (
            <VaultTabItem
              context={ctx}
              isSelected={ctx.id === selectedContextId}
              key={ctx.id}
              onAliasChange={(alias) => updateContextAlias(ctx.id, alias)}
              onColorChange={(color) => updateContextColor(ctx.id, color)}
              // §82 Both directions live in one place now — they differed only in
              // one IPC call, and both were missing the tab re-key that keeps the
              // new context id attached to the tabs it already owns.
              onConvertType={
                ctx.contextType === "folder" || ctx.contextType === "vault"
                  ? () => convertContextType(ctx)
                  : undefined
              }
              onLabelChange={(label) => updateContextLabel(ctx.id, label)}
              // §82 Same door as the context tab's x. This path used to skip
              // closing the context's editor tabs, leaving them pointing at an id
              // that no longer existed.
              onRemove={() => requestCloseContexts([ctx.id])}
              onSelect={() => setSelectedContextId(ctx.id)}
            />
          ))
        )}
      </div>

      <div className="vault-tab-actions">
        <button className="vault-tab-add-btn" onClick={handleAddFolder}>
          <Folder size={14} />
          {t("settings.vault.addFolder")}
        </button>
      </div>

      {selectedContext && selectedContext.contextType === "vault" && (
        <VaultSettingsSection contextPath={selectedContext.path} />
      )}
      {selectedContext && selectedContext.contextType === "folder" && (
        <p className="settings-section-desc">
          {/* The action is interpolated rather than spelled out twice: it is also the label of
              the button that performs it, and a rename would otherwise leave this sentence
              pointing at a menu item that no longer exists under that name. */}
          {t("settings.vault.folderNotice", {
            action: t("settings.vault.initialize"),
          })}
        </p>
      )}

      <ApprovedRootsSection />
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
  const { t } = useTranslation();
  return (
    <div className="vault-settings-row">
      <span className="vault-settings-row__label">{label}</span>
      <div className="vault-settings-row__control">
        <button
          className={`vault-three-state-btn ${value === undefined ? "vault-three-state-btn--active" : ""}`}
          onClick={() => onChange(undefined)}
          type="button"
        >
          {t("settings.vault.state.default")}
        </button>
        <button
          className={`vault-three-state-btn ${value === true ? "vault-three-state-btn--active" : ""}`}
          onClick={() => onChange(true)}
          type="button"
        >
          {t("settings.vault.state.on")}
        </button>
        <button
          className={`vault-three-state-btn ${value === false ? "vault-three-state-btn--active" : ""}`}
          onClick={() => onChange(false)}
          type="button"
        >
          {t("settings.vault.state.off")}
        </button>
      </div>
    </div>
  );
}

// ── VaultSettingsSection ────────────────────────────────────────────────────

function VaultExtensionToggle({
  config,
  extId,
  labelKey,
  onSave,
}: {
  config: VaultConfig;
  extId: string;
  labelKey: string;
  onSave: (updated: VaultConfig) => void;
}) {
  const { t } = useTranslation();
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
      <span className="vault-settings-row__label">{t(labelKey)}</span>
      <div className="vault-settings-row__control">
        <button
          className={`vault-three-state-btn ${state === "default" ? "vault-three-state-btn--active" : ""}`}
          onClick={() => handleChange("default")}
          type="button"
        >
          {t("settings.vault.state.default")}
        </button>
        <button
          className={`vault-three-state-btn ${state === "enabled" ? "vault-three-state-btn--active" : ""}`}
          onClick={() => handleChange("enabled")}
          type="button"
        >
          {t("settings.vault.state.enabled")}
        </button>
        <button
          className={`vault-three-state-btn ${state === "disabled" ? "vault-three-state-btn--active" : ""}`}
          onClick={() => handleChange("disabled")}
          type="button"
        >
          {t("settings.vault.state.disabled")}
        </button>
      </div>
    </div>
  );
}

// ── VaultTab ────────────────────────────────────────────────────────────────

function VaultSettingsSection({ contextPath }: { contextPath: string }) {
  const { t } = useTranslation();
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

  if (loading)
    return (
      <p className="vault-settings-loading">{t("settings.vault.loading")}</p>
    );
  if (!config) return null;

  const bulletMarker =
    (config.markdown?.serializationRules?.bulletListMarker as string) ?? "";

  return (
    <>
      <h3 className="settings-section-title" style={{ marginTop: 24 }}>
        {t("settings.vault.override")}
      </h3>
      <p className="settings-section-desc">
        {t("settings.vault.override.desc")}
      </p>

      {/* Extensions */}
      <div className="vault-settings-group">
        <h4 className="vault-settings-group__title">
          {t("settings.vault.extensions")}
        </h4>
        {VAULT_EXTENSIONS.map(({ extId, labelKey }) => (
          <VaultExtensionToggle
            config={config}
            extId={extId}
            key={extId}
            labelKey={labelKey}
            onSave={saveConfig}
          />
        ))}
      </div>

      {/* Markdown */}
      <div className="vault-settings-group">
        <h4 className="vault-settings-group__title">
          {t("settings.vault.markdown")}
        </h4>
        <ThreeStateToggle
          label={t("settings.vault.markdownWikilinks")}
          onChange={(v) =>
            saveConfig({
              ...config,
              markdown: { ...config.markdown, enableWikilink: v },
            })
          }
          value={config.markdown?.enableWikilink}
        />
        <ThreeStateToggle
          label={t("settings.vault.markdownMermaid")}
          onChange={(v) =>
            saveConfig({
              ...config,
              markdown: { ...config.markdown, enableMermaid: v },
            })
          }
          value={config.markdown?.enableMermaid}
        />
        <SelectSetting
          label={t("settings.vault.bulletMarker")}
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
            { label: t("settings.vault.bulletMarker.global"), value: "" },
            { label: t("settings.vault.bulletMarker.dash"), value: "-" },
            { label: t("settings.vault.bulletMarker.asterisk"), value: "*" },
            { label: t("settings.vault.bulletMarker.plus"), value: "+" },
          ]}
          value={bulletMarker}
        />
      </div>

      {/* AI */}
      <div className="vault-settings-group">
        <h4 className="vault-settings-group__title">
          {t("settings.vault.group.ai")}
        </h4>
        <TextSetting
          label={t("settings.vault.aiModelOverride")}
          onChange={(v) =>
            saveConfig({
              ...config,
              ai: { ...config.ai, model: v || undefined },
            })
          }
          placeholder={t("settings.vault.aiModelOverride.placeholder")}
          value={config.ai?.model ?? ""}
        />
        <ThreeStateToggle
          label={t("settings.ai.privacyMode")}
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
        <h4 className="vault-settings-group__title">
          {t("settings.vault.workLog")}
        </h4>
        <ThreeStateToggle
          label={t("settings.vault.workLogEnabled")}
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
              label={t("settings.vault.workLogFolder")}
              onChange={(v) =>
                saveConfig({
                  ...config,
                  workLog: { ...config.workLog, folder: v || undefined },
                })
              }
              placeholder={t("settings.vault.workLogFolder.placeholder")}
              value={config.workLog?.folder ?? ""}
            />
            <TextSetting
              label={t("settings.vault.workLogTemplate")}
              onChange={(v) =>
                saveConfig({
                  ...config,
                  workLog: { ...config.workLog, template: v || undefined },
                })
              }
              placeholder={t("settings.vault.workLogTemplate.placeholder")}
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
  onConvertType,
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
  onConvertType?: () => void;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
  onSelect?: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);

  const typeLabel =
    context.vaultType === "journal"
      ? t("settings.vault.type.journal")
      : context.contextType === "vault"
        ? t("settings.vault.type.vault")
        : context.contextType === "folder"
          ? t("settings.vault.type.folder")
          : t("settings.vault.type.file");

  // One label, used as both the button's text and its tooltip. It was written out twice, so a
  // wording change had to be made in two places that nothing tied together.
  const convertLabel =
    context.contextType === "folder"
      ? t("settings.vault.initialize")
      : t("settings.vault.revert");

  return (
    <div
      className={`vault-tab-item ${isSelected ? "vault-tab-item--selected" : ""}`}
      onClick={onSelect}
    >
      <button
        className="vault-tab-item__color"
        onClick={() => setShowColors((v) => !v)}
        style={{ backgroundColor: context.color }}
        title={t("settings.vault.item.changeColor")}
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
            title={t("settings.vault.item.renameHint")}
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
                placeholder={t("settings.vault.item.aliasPlaceholder")}
                ref={aliasInputRef}
              />
            ) : (
              <span
                className="vault-tab-item__alias-value"
                onDoubleClick={() => setEditingAlias(true)}
                title={t("settings.vault.item.aliasHint")}
              >
                {t("settings.vault.item.alias", {
                  value: context.alias || t("settings.vault.item.aliasUnset"),
                })}
              </span>
            )}
          </span>
        )}
        <span className="vault-tab-item__meta">
          {typeLabel} · {context.path}
        </span>
      </div>
      <div className="vault-tab-item__actions">
        {onConvertType && (
          <button
            className="vault-tab-item__convert"
            onClick={(e) => {
              e.stopPropagation();
              onConvertType();
            }}
            title={convertLabel}
          >
            {convertLabel}
          </button>
        )}
        <button
          className="vault-tab-item__remove icon-btn"
          onClick={onRemove}
          title={t("common.close")}
        >
          <X size={14} />
        </button>
      </div>

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

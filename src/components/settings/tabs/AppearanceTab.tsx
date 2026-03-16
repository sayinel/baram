import { useCallback, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { WorkspacePreset } from "../../../stores/file/workspace";
import type { ThemeDef } from "../../../types/theme";

import { useTranslation } from "../../../i18n/useTranslation";
import { readFile } from "../../../ipc/invoke";
import {
  BUILTIN_PRESETS,
  useWorkspaceStore,
} from "../../../stores/file/workspace";
import { useSettingsStore } from "../../../stores/settings/store";
import {
  BUILT_IN_THEMES,
  migrateThemeColors,
  THEME_COLOR_KEYS,
} from "../../../types/theme";
import { logger } from "../../../utils/logger";
import { SettingsSectionHeader } from "../settings-shared";
import { ThemeEditor } from "../ThemeEditor";

// ─── Theme Mini Preview ─────────────────────────────────

export function AppearanceTab() {
  const { t } = useTranslation();
  const {
    activeThemeId,
    customThemes,
    setActiveTheme,
    saveCustomTheme,
    deleteCustomTheme,
  } = useSettingsStore();
  const [editingTheme, setEditingTheme] = useState(false);

  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  const handleImport = useCallback(async () => {
    const selected = await open({
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!selected) return;
    try {
      const content = await readFile(selected);
      const data = JSON.parse(content);
      // Validate required fields
      if (typeof data.name !== "string" || !data.name) {
        throw new Error("Missing or invalid 'name' field");
      }
      if (data.base !== "light" && data.base !== "dark") {
        throw new Error("'base' must be 'light' or 'dark'");
      }
      if (!data.colors || typeof data.colors !== "object") {
        throw new Error("Missing or invalid 'colors' object");
      }
      // Migrate old key names (pre-v10) to current names
      data.colors = migrateThemeColors(data.colors);
      // Validate all 16 color keys are present
      const requiredKeys = THEME_COLOR_KEYS.map((k) => k.key);
      for (const key of requiredKeys) {
        if (typeof data.colors[key] !== "string") {
          throw new Error(`Missing color key: ${key}`);
        }
      }
      const newTheme: ThemeDef = {
        id: "custom-" + Date.now(),
        name: data.name,
        base: data.base,
        colors: data.colors,
        builtIn: false,
      };
      saveCustomTheme(newTheme);
      setActiveTheme(newTheme.id);
    } catch (err) {
      logger.error("Theme import failed:", err);
    }
  }, [saveCustomTheme, setActiveTheme]);

  if (editingTheme) {
    return <ThemeEditor onClose={() => setEditingTheme(false)} />;
  }

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.appearance.theme")} />

      <div className="theme-gallery">
        {/* System (Auto) card */}
        <button
          className={`theme-card theme-system-card ${activeThemeId === "system" ? "theme-card-active" : ""}`}
          onClick={() => setActiveTheme("system")}
        >
          <div className="theme-preview theme-preview-split">
            <div
              className="theme-preview-half"
              style={{ background: "#ffffff" }}
            >
              <div
                className="theme-preview-sidebar"
                style={{
                  background: "#f5f5f5",
                  borderRight: "1px solid #e5e5e5",
                }}
              >
                <div
                  className="theme-preview-sidebar-item"
                  style={{ background: "#e0e0e0" }}
                />
                <div
                  className="theme-preview-sidebar-item"
                  style={{ background: "#e0e0e0" }}
                />
              </div>
              <div
                className="theme-preview-editor"
                style={{ background: "#ffffff" }}
              >
                <div
                  className="theme-preview-heading"
                  style={{ color: "#1a1a1a", fontSize: 7 }}
                >
                  Aa
                </div>
              </div>
            </div>
            <div
              className="theme-preview-half"
              style={{ background: "#1a1a2e" }}
            >
              <div
                className="theme-preview-sidebar"
                style={{
                  background: "#16213e",
                  borderRight: "1px solid #2a2a4a",
                }}
              >
                <div
                  className="theme-preview-sidebar-item"
                  style={{ background: "#2a2a4a" }}
                />
                <div
                  className="theme-preview-sidebar-item"
                  style={{ background: "#2a2a4a" }}
                />
              </div>
              <div
                className="theme-preview-editor"
                style={{ background: "#1a1a2e" }}
              >
                <div
                  className="theme-preview-heading"
                  style={{ color: "#e2e8f0", fontSize: 7 }}
                >
                  Aa
                </div>
              </div>
            </div>
          </div>
          <span className="theme-card-name">
            {t("settings.appearance.systemAuto")}
          </span>
        </button>

        {/* All themes */}
        {allThemes.map((theme) => (
          <button
            className={`theme-card ${activeThemeId === theme.id ? "theme-card-active" : ""}`}
            key={theme.id}
            onClick={() => setActiveTheme(theme.id)}
            style={
              activeThemeId === theme.id
                ? { borderColor: theme.colors["--color-accent-default"] }
                : undefined
            }
          >
            <ThemeMiniPreview theme={theme} />
            <span className="theme-card-name">{theme.name}</span>
            {!theme.builtIn && (
              <span className="theme-card-badge">
                {t("settings.appearance.customBadge")}
              </span>
            )}
            {!theme.builtIn && (
              <button
                className="theme-card-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteCustomTheme(theme.id);
                }}
                title={t("settings.appearance.deleteTheme")}
              >
                {"\u00D7"}
              </button>
            )}
          </button>
        ))}
      </div>

      <div className="theme-actions">
        <button
          className="theme-action-btn"
          onClick={() => setEditingTheme(true)}
        >
          {t("settings.appearance.customize")}
        </button>
        <button className="theme-action-btn" onClick={handleImport}>
          {t("settings.appearance.import")}
        </button>
      </div>

      <SettingsSectionHeader
        title={t("settings.appearance.workspacePresets")}
      />
      <WorkspaceSection />
    </div>
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

// ─── Workspace Layout Summary ───────────────────────────

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
          {"\u00D7"}
        </button>
      )}

      <div className="workspace-card-layout">
        <LayoutDiagram preset={preset} />
      </div>

      <span className="workspace-card-name">
        {preset.builtIn
          ? t(`settings.workspace.preset.${preset.id}`)
          : preset.name}
      </span>
      {preset.description && (
        <span className="workspace-card-desc">
          {preset.builtIn
            ? t(`settings.workspace.preset.${preset.id}.desc`)
            : preset.description}
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

// ─── Preset Card ────────────────────────────────────────

function ThemeMiniPreview({ theme }: { theme: ThemeDef }) {
  const c = theme.colors;
  return (
    <div
      className="theme-preview"
      style={{ background: c["--color-bg-default"] }}
    >
      <div
        className="theme-preview-sidebar"
        style={{
          background: c["--color-bg-panel"],
          borderRight: `1px solid ${c["--color-border-default"]}`,
        }}
      >
        <div
          className="theme-preview-sidebar-item"
          style={{ background: c["--color-bg-elevated"] }}
        />
        <div
          className="theme-preview-sidebar-item"
          style={{ background: c["--color-bg-elevated"] }}
        />
        <div
          className="theme-preview-sidebar-item"
          style={{ background: c["--color-bg-elevated"] }}
        />
      </div>
      <div
        className="theme-preview-editor"
        style={{ background: c["--color-editor-bg"] }}
      >
        <div
          className="theme-preview-heading"
          style={{ color: c["--color-editor-text"] }}
        >
          Heading
        </div>
        <div
          className="theme-preview-text"
          style={{ color: c["--color-editor-text"] }}
        >
          Some{" "}
          <span style={{ color: c["--color-accent-default"], fontWeight: 600 }}>
            bold
          </span>{" "}
          text
        </div>
        <div
          className="theme-preview-quote"
          style={{
            borderLeft: `2px solid ${c["--color-accent-default"]}`,
            color: c["--color-text-secondary"],
            paddingLeft: 6,
          }}
        >
          blockquote
        </div>
        <div
          className="theme-preview-code"
          style={{
            background: c["--color-bg-elevated"],
            color: c["--color-editor-text"],
          }}
        >
          code
        </div>
      </div>
    </div>
  );
}

// ─── Workspace Section ──────────────────────────────────

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

// ─── Appearance Tab ─────────────────────────────────────

function WorkspaceSection() {
  const { t } = useTranslation();
  const {
    activePresetId,
    customPresets,
    applyPreset,
    saveCustomPreset,
    deleteCustomPreset,
  } = useWorkspaceStore();

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
    <>
      <div className="workspace-gallery">
        {allPresets.map((preset) => (
          <PresetCard
            isActive={activePresetId === preset.id}
            key={preset.id}
            onApply={handleApply}
            onDelete={!preset.builtIn ? deleteCustomPreset : undefined}
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

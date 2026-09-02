import { useCallback, useState } from "react";

import type { WorkspacePreset } from "../../../stores/file/workspace";
import type { ThemeDef } from "../../../types/theme";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import {
  BUILTIN_PRESETS,
  useWorkspaceStore,
} from "../../../stores/file/workspace";
import { useSettingsStore } from "../../../stores/settings/store";
import { BUILT_IN_THEMES } from "../../../types/theme";
import { SettingsSectionHeader } from "../settings-shared";
import { ThemeEditor } from "../ThemeEditor";
import { useThemeImport } from "./use-theme-import";

// ─── Theme Mini Preview ─────────────────────────────────

export function AppearanceTab() {
  const { t } = useTranslation();
  const { activeThemeId, customThemes, setActiveTheme, deleteCustomTheme } =
    useSettingsStore(
      useShallow((s) => ({
        activeThemeId: s.activeThemeId,
        customThemes: s.customThemes,
        setActiveTheme: s.setActiveTheme,
        deleteCustomTheme: s.deleteCustomTheme,
      })),
    );
  const [editingTheme, setEditingTheme] = useState(false);
  const { handleImport, importError } = useThemeImport();

  const allThemes = [...BUILT_IN_THEMES, ...customThemes];

  if (editingTheme) {
    return <ThemeEditor onClose={() => setEditingTheme(false)} />;
  }

  return (
    <div className="settings-section">
      <SettingsSectionHeader title={t("settings.appearance.theme")} />

      <div className="theme-gallery">
        {/* System (Auto) card */}
        <button
          aria-pressed={activeThemeId === "system"}
          className={`theme-card theme-system-card ${activeThemeId === "system" ? "theme-card-active" : ""}`}
          onClick={() => setActiveTheme("system")}
        >
          {/* 프리뷰는 장식이다 — 숨기지 않으면 카드의 accessible name에
              프리뷰 텍스트("Aa Aa")까지 섞여 읽힌다(적대 리뷰). */}
          <div aria-hidden="true" className="theme-preview theme-preview-split">
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

        {/* All themes. \uCE74\uB4DC\uC640 \uC0AD\uC81C \uBC84\uD2BC\uC740 \uD615\uC81C\uB2E4 \u2014 button \uC548\uC5D0 button\uC740 HTML\uC774
            \uAE08\uC9C0\uD558\uB294 \uC911\uCCA9(interactive content)\uC774\uB77C \uBE0C\uB77C\uC6B0\uC800\uAC00 \uD2B8\uB9AC\uB97C \uC7AC\uAD6C\uC131\uD560 \uC218
            \uC788\uACE0, \uBCF4\uC870\uAE30\uAE30\uC5D0\uB294 \uC0AD\uC81C \uBC84\uD2BC\uC774 \uCE74\uB4DC \uB808\uC774\uBE14\uC758 \uC77C\uBD80\uB85C \uC77D\uD78C\uB2E4. \uACB9\uCCD0
            \uBCF4\uC774\uB294 \uBC30\uCE58\uB294 wrapper\uC758 position: relative\uAC00 \uB9E1\uB294\uB2E4. */}
        {allThemes.map((theme) => (
          <div className="theme-card-wrap" key={theme.id}>
            <button
              aria-pressed={activeThemeId === theme.id}
              className={`theme-card ${activeThemeId === theme.id ? "theme-card-active" : ""}`}
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
            </button>
            {!theme.builtIn && (
              // \uC0AD\uC81C \uB300\uC0C1 \uC774\uB984\uC744 accessible name\uC5D0 \uD3EC\uD568\uD55C\uB2E4 \u2014 \uCEE4\uC2A4\uD140 \uD14C\uB9C8\uAC00
              // \uC5EC\uB7FF\uC774\uBA74 "\uD14C\uB9C8 \uC0AD\uC81C"\uB9CC\uC73C\uB85C\uB294 \uC5B4\uB290 \uBC84\uD2BC\uC778\uC9C0 \uAD6C\uBD84\uD560 \uC218 \uC5C6\uB2E4.
              <button
                aria-label={t("settings.appearance.deleteThemeNamed", {
                  name: theme.name,
                })}
                className="theme-card-delete"
                onClick={() => deleteCustomTheme(theme.id)}
                title={t("settings.appearance.deleteThemeNamed", {
                  name: theme.name,
                })}
              >
                {"\u00D7"}
              </button>
            )}
          </div>
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
      {importError !== null && (
        <div className="theme-import-error" role="alert">
          {t("settings.appearance.importFailed")}: {importError}
        </div>
      )}

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
    // 장식 프리뷰 — 숨기지 않으면 카드 button의 accessible name에 프리뷰의
    // 더미 텍스트(Heading, bold …)까지 전부 섞여 읽힌다(적대 리뷰).
    <div
      aria-hidden="true"
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

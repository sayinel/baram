// §69 Plugin Developer section — load/reload local plugin folders during development.
// §379 — in a release build, behind the developer-mode switch and the folder's consent;
// the actions live in `use-dev-plugin-actions.ts`.
import { useState } from "react";

import type { InstalledPlugin, PluginCapability } from "../../plugins/types";

import { FolderOpen } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { describeDevError } from "../../ipc/plugin-dev-errors";
import { usePluginStore } from "../../stores/system/plugin";
import { SettingsRow, ToggleSwitch } from "../settings/settings-shared";
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";
import { PluginConsentDialog } from "./PluginConsentDialog";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { useDevPluginActions } from "./use-dev-plugin-actions";

export function PluginDeveloperSection() {
  const { t } = useTranslation();
  const { devFolderIssues, devMode, devPlugins, pluginErrors } = usePluginStore(
    useShallow((s) => ({
      devFolderIssues: s.devFolderIssues,
      devMode: s.devMode,
      devPlugins: s.devPlugins,
      pluginErrors: s.pluginErrors,
    })),
  );
  const actions = useDevPluginActions();
  const list = Object.values(devPlugins);

  const [selectedId, setSelectedId] = useState<null | string>(null);
  const selected = list.find((p) => p.manifest.id === selectedId);

  async function handleRemove(plugin: InstalledPlugin) {
    await actions.handleRemove(plugin.installPath, plugin);
    if (selectedId === plugin.manifest.id) setSelectedId(null);
  }

  return (
    <section className="settings-section plugin-dev-section">
      {actions.pendingConsent && (
        <PluginConsentDialog
          consent={actions.pendingConsent.consent}
          intent="load"
          name={actions.pendingConsent.name}
          onCancel={() => actions.settleConsent(false)}
          onConfirm={() => actions.settleConsent(true)}
          prior={actions.pendingConsent.prior}
        />
      )}
      <h3 className="settings-section-title">{t("plugin.dev.title")}</h3>
      <p className="settings-section-desc">{t("plugin.dev.description")}</p>

      {/* §379 F1 — only a release build has a switch; a dev build is always on. */}
      {!devMode.devBuild && (
        <SettingsRow
          description={t("plugin.dev.mode.description")}
          label={t("plugin.dev.mode.label")}
        >
          <ToggleSwitch
            checked={devMode.enabled}
            onChange={actions.handleToggleMode}
          />
        </SettingsRow>
      )}

      {devMode.active ? (
        <>
          <div className="plugin-dev-load-row">
            <span className="plugin-dev-load-row__label">
              {t("plugin.dev.load")}
            </span>
            <button
              className="plugin-dev-load-btn"
              onClick={actions.handleLoad}
              title={t("plugin.dev.loadTitle")}
              type="button"
            >
              <FolderOpen size={16} />
            </button>
          </div>

          <div className="vault-tab-list">
            {list.length === 0 && devFolderIssues.length === 0 ? (
              <p className="vault-tab-empty">{t("plugin.dev.empty")}</p>
            ) : (
              <>
                {list.map((p) => (
                  <div
                    className={`vault-tab-item ${
                      selectedId === p.manifest.id
                        ? "vault-tab-item--selected"
                        : ""
                    }`}
                    key={p.manifest.id}
                    onClick={() =>
                      setSelectedId((cur) =>
                        cur === p.manifest.id ? null : p.manifest.id,
                      )
                    }
                  >
                    <div className="vault-tab-item__info">
                      <span className="vault-tab-item__name">
                        {p.manifest.name}
                      </span>
                      <span className="vault-tab-item__meta">
                        {p.manifest.id} · v{p.manifest.version} ·{" "}
                        {t("plugin.dev.badge")}
                      </span>
                    </div>
                  </div>
                ))}
                {devFolderIssues.map((issue) => (
                  <div className="vault-tab-item" key={issue.path}>
                    <div className="vault-tab-item__info">
                      <span className="vault-tab-item__name text-truncate">
                        {issue.path}
                      </span>
                      <span className="plugin-dev-detail__error">
                        {describeDevError(issue.error, t)}
                      </span>
                    </div>
                    <button
                      className="plugin-dev-btn plugin-dev-btn--danger"
                      onClick={() => actions.handleRemove(issue.path)}
                      type="button"
                    >
                      {t("plugin.dev.remove")}
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>

          {selected && (
            <DevPluginDetail
              error={pluginErrors[selected.manifest.id]}
              onReload={() => actions.handleReload(selected)}
              onRemove={() => handleRemove(selected)}
              plugin={selected}
            />
          )}
        </>
      ) : (
        <p className="vault-tab-empty">{t("plugin.dev.mode.off")}</p>
      )}
    </section>
  );
}

function DevPluginDetail({
  plugin,
  error,
  onReload,
  onRemove,
}: {
  error: string | undefined;
  onReload: () => void;
  onRemove: () => void;
  plugin: InstalledPlugin;
}) {
  const { t } = useTranslation();
  const { manifest, installPath } = plugin;
  return (
    <div className="plugin-dev-detail">
      <h4 className="plugin-dev-detail__name">{manifest.name}</h4>
      <p className="plugin-dev-detail__meta">
        {t("plugin.dev.meta", {
          author: manifest.author || "—",
          id: manifest.id,
          version: manifest.version,
        })}
      </p>
      <div className="plugin-dev-detail__row">
        <span className="plugin-dev-detail__row-label">
          {t("plugin.dev.path")}
        </span>
        <code className="plugin-dev-detail__path text-truncate">
          {installPath}
        </code>
      </div>
      {manifest.capabilities.length > 0 && (
        <div className="plugin-dev-detail__row">
          <span className="plugin-dev-detail__row-label">
            {t("plugin.detail.capabilities")}
          </span>
          <div className="plugin-dev-detail__capabilities">
            {manifest.capabilities.map((c: PluginCapability) => (
              <PluginCapabilityBadge capability={c} key={c} />
            ))}
          </div>
        </div>
      )}
      {/* §260 Phase 4c — a dev plugin is configured HERE, because it never appears in the
          registry and so never opens `PluginDetail`. Without this the settings form would
          be unreachable for exactly the plugins being developed against it. */}
      <PluginSettingsForm pluginId={manifest.id} />
      <div className="plugin-dev-detail__actions">
        <button className="plugin-dev-btn" onClick={onReload} type="button">
          {t("plugin.action.reload")}
        </button>
        <button
          className="plugin-dev-btn plugin-dev-btn--danger"
          onClick={onRemove}
          type="button"
        >
          {t("plugin.dev.remove")}
        </button>
      </div>
      {error && <p className="plugin-dev-detail__error">{error}</p>}
    </div>
  );
}

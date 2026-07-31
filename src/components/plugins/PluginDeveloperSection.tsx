// §69 Plugin Developer section — load/reload local plugin folders during development
import { useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { InstalledPlugin, PluginCapability } from "../../plugins/types";

import { FolderOpen } from "lucide-react";
import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import {
  pluginAddDevFolder,
  pluginRemoveDevFolder,
  toInstalledDevPlugin,
} from "../../ipc/plugin-invoke";
import { pluginLoader } from "../../plugins/plugin-loader";
import { usePluginStore } from "../../stores/system/plugin";
import { useUIStore } from "../../stores/ui/ui";
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";
import { PluginSettingsForm } from "./PluginSettingsForm";

export function PluginDeveloperSection() {
  const { t } = useTranslation();
  const { devPlugins, pluginErrors, addDevPlugin, removeDevPlugin, setError } =
    usePluginStore(
      useShallow((s) => ({
        devPlugins: s.devPlugins,
        pluginErrors: s.pluginErrors,
        addDevPlugin: s.addDevPlugin,
        removeDevPlugin: s.removeDevPlugin,
        setError: s.setError,
      })),
    );
  const showToast = useUIStore((s) => s.showToast);
  const list = Object.values(devPlugins);

  const [selectedId, setSelectedId] = useState<null | string>(null);
  const selected = list.find((p) => p.manifest.id === selectedId);

  async function handleLoad() {
    const picked = await open({ directory: true });
    if (typeof picked !== "string") return;
    try {
      const info = await pluginAddDevFolder(picked);
      const plugin = toInstalledDevPlugin(info);
      // `isDev` is DECLARED, not inferred (§260 Phase 5 re-review, G1): `addDevPlugin`
      // runs on the next line, deliberately after the load so a failing load leaves no
      // card — so the store cannot yet be asked whether this is a dev folder.
      await pluginLoader.loadPlugin(plugin.installPath, plugin.manifest, {
        isDev: true,
      });
      addDevPlugin(plugin);
      // §260 3c-3 — a load that SUCCEEDS must clear the last failure. Nothing did,
      // so a transient error (e.g. one activate timeout at startup) stayed on the
      // card forever, describing a plugin that is now running fine.
      setError(plugin.manifest.id, null);
      showToast(t("plugin.dev.toast.loaded", { name: plugin.manifest.name }));
    } catch (err) {
      showToast(t("plugin.dev.toast.loadFailed", { error: String(err) }));
    }
  }

  async function handleReload(plugin: InstalledPlugin) {
    try {
      const info = await pluginAddDevFolder(plugin.installPath); // re-read manifest
      const fresh = toInstalledDevPlugin(info);
      await pluginLoader.reloadPlugin(fresh.installPath, fresh.manifest, {
        isDev: true,
      });
      addDevPlugin(fresh);
      setError(fresh.manifest.id, null); // the reload worked — drop the stale failure
      if (fresh.manifest.tiptapExtensions?.length) {
        showToast(
          t("plugin.dev.toast.reloadedRestart", {
            name: fresh.manifest.name,
          }),
        );
      } else {
        showToast(
          t("plugin.dev.toast.reloaded", { name: fresh.manifest.name }),
        );
      }
    } catch (err) {
      setError(plugin.manifest.id, String(err));
      showToast(t("plugin.dev.toast.reloadFailed", { error: String(err) }));
    }
  }

  async function handleRemove(plugin: InstalledPlugin) {
    try {
      await pluginRemoveDevFolder(plugin.installPath);
      await pluginLoader.unloadPlugin(plugin.manifest.id);
      removeDevPlugin(plugin.manifest.id);
      if (selectedId === plugin.manifest.id) setSelectedId(null);
      showToast(t("plugin.dev.toast.removed", { name: plugin.manifest.name }));
    } catch (err) {
      showToast(t("plugin.dev.toast.removeFailed", { error: String(err) }));
    }
  }

  return (
    <section className="settings-section plugin-dev-section">
      <h3 className="settings-section-title">{t("plugin.dev.title")}</h3>
      <p className="settings-section-desc">{t("plugin.dev.description")}</p>

      <div className="plugin-dev-load-row">
        <span className="plugin-dev-load-row__label">
          {t("plugin.dev.load")}
        </span>
        <button
          className="plugin-dev-load-btn"
          onClick={handleLoad}
          title={t("plugin.dev.loadTitle")}
          type="button"
        >
          <FolderOpen size={16} />
        </button>
      </div>

      <div className="vault-tab-list">
        {list.length === 0 ? (
          <p className="vault-tab-empty">{t("plugin.dev.empty")}</p>
        ) : (
          list.map((p) => (
            <div
              className={`vault-tab-item ${
                selectedId === p.manifest.id ? "vault-tab-item--selected" : ""
              }`}
              key={p.manifest.id}
              onClick={() =>
                setSelectedId((cur) =>
                  cur === p.manifest.id ? null : p.manifest.id,
                )
              }
            >
              <div className="vault-tab-item__info">
                <span className="vault-tab-item__name">{p.manifest.name}</span>
                <span className="vault-tab-item__meta">
                  {p.manifest.id} · v{p.manifest.version}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {selected && (
        <DevPluginDetail
          error={pluginErrors[selected.manifest.id]}
          onReload={() => handleReload(selected)}
          onRemove={() => handleRemove(selected)}
          plugin={selected}
        />
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
          {t("plugin.action.remove")}
        </button>
      </div>
      {error && <p className="plugin-dev-detail__error">{error}</p>}
    </div>
  );
}

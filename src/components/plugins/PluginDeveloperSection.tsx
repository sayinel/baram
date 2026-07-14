// §69 Plugin Developer section — load/reload local plugin folders during development
import { useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { InstalledPlugin, PluginCapability } from "../../plugins/types";

import { FolderOpen } from "lucide-react";
import { useShallow } from "zustand/shallow";

import {
  pluginAddDevFolder,
  pluginRemoveDevFolder,
  toInstalledDevPlugin,
} from "../../ipc/plugin-invoke";
import { pluginLoader } from "../../plugins/plugin-loader";
import { usePluginStore } from "../../stores/system/plugin";
import { useUIStore } from "../../stores/ui/ui";
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";

export function PluginDeveloperSection() {
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
      await pluginLoader.loadPlugin(plugin.installPath, plugin.manifest);
      addDevPlugin(plugin);
      showToast(`Loaded dev plugin: ${plugin.manifest.name}`);
    } catch (err) {
      showToast(`Failed to load dev plugin: ${String(err)}`);
    }
  }

  async function handleReload(plugin: InstalledPlugin) {
    try {
      const info = await pluginAddDevFolder(plugin.installPath); // re-read manifest
      const fresh = toInstalledDevPlugin(info);
      await pluginLoader.reloadPlugin(fresh.installPath, fresh.manifest);
      addDevPlugin(fresh);
      if (fresh.manifest.tiptapExtensions?.length) {
        showToast(
          `Reloaded ${fresh.manifest.name} — restart required for Tiptap extensions`,
        );
      } else {
        showToast(`Reloaded dev plugin: ${fresh.manifest.name}`);
      }
    } catch (err) {
      setError(plugin.manifest.id, String(err));
      showToast(`Reload failed: ${String(err)}`);
    }
  }

  async function handleRemove(plugin: InstalledPlugin) {
    try {
      await pluginRemoveDevFolder(plugin.installPath);
      await pluginLoader.unloadPlugin(plugin.manifest.id);
      removeDevPlugin(plugin.manifest.id);
      if (selectedId === plugin.manifest.id) setSelectedId(null);
      showToast(`Removed dev plugin: ${plugin.manifest.name}`);
    } catch (err) {
      showToast(`Remove failed: ${String(err)}`);
    }
  }

  return (
    <section className="settings-section plugin-dev-section">
      <h3 className="settings-section-title">Developer</h3>
      <p className="settings-section-desc">
        Load and reload local plugin folders in dev.
      </p>

      <div className="plugin-dev-load-row">
        <span className="plugin-dev-load-row__label">
          Load dev plugin folder
        </span>
        <button
          className="icon-btn"
          onClick={handleLoad}
          title="Load dev plugin folder…"
          type="button"
        >
          <FolderOpen size={16} />
        </button>
      </div>

      <div className="vault-tab-list">
        {list.length === 0 ? (
          <p className="vault-tab-empty">
            No dev plugins loaded. Point at a folder with baram-plugin.json.
          </p>
        ) : (
          list.map((p) => (
            <div
              className={`vault-tab-item ${
                selectedId === p.manifest.id ? "vault-tab-item--selected" : ""
              }`}
              key={p.manifest.id}
              onClick={() => setSelectedId(p.manifest.id)}
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
  const { manifest, installPath } = plugin;
  return (
    <div className="plugin-dev-detail">
      <h4 className="plugin-dev-detail__name">{manifest.name}</h4>
      <p className="plugin-dev-detail__meta">
        ID {manifest.id} · Version {manifest.version} · Author{" "}
        {manifest.author || "—"}
      </p>
      <div className="plugin-dev-detail__row">
        <span className="plugin-dev-detail__row-label">Path</span>
        <code className="plugin-dev-detail__path text-truncate">
          {installPath}
        </code>
      </div>
      {manifest.capabilities.length > 0 && (
        <div className="plugin-dev-detail__row">
          <span className="plugin-dev-detail__row-label">Capabilities</span>
          <div className="plugin-dev-detail__capabilities">
            {manifest.capabilities.map((c: PluginCapability) => (
              <PluginCapabilityBadge capability={c} key={c} />
            ))}
          </div>
        </div>
      )}
      <div className="plugin-dev-detail__actions">
        <button className="icon-btn" onClick={onReload} type="button">
          Reload
        </button>
        <button className="icon-btn" onClick={onRemove} type="button">
          Remove
        </button>
      </div>
      {error && <p className="plugin-dev-detail__error">{error}</p>}
    </div>
  );
}

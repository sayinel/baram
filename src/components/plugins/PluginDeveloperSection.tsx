// §69 Plugin Developer section — load/reload local plugin folders during development
import { open } from "@tauri-apps/plugin-dialog";

import type { InstalledPlugin } from "../../plugins/types";

import { useShallow } from "zustand/shallow";

import {
  pluginAddDevFolder,
  pluginRemoveDevFolder,
} from "../../ipc/plugin-invoke";
import { pluginLoader } from "../../plugins/plugin-loader";
import { usePluginStore } from "../../stores/system/plugin";
import { useUIStore } from "../../stores/ui/ui";

export function PluginDeveloperSection() {
  const { devPlugins, addDevPlugin, removeDevPlugin } = usePluginStore(
    useShallow((s) => ({
      devPlugins: s.devPlugins,
      addDevPlugin: s.addDevPlugin,
      removeDevPlugin: s.removeDevPlugin,
    })),
  );
  const showToast = useUIStore((s) => s.showToast);
  const list = Object.values(devPlugins);

  async function handleLoad() {
    const picked = await open({ directory: true });
    if (typeof picked !== "string") return;
    try {
      const info = await pluginAddDevFolder(picked);
      const plugin = toInstalled(info);
      addDevPlugin(plugin);
      await pluginLoader.loadPlugin(plugin.installPath, plugin.manifest);
      showToast(`Loaded dev plugin: ${plugin.manifest.name}`);
    } catch (err) {
      showToast(`Failed to load dev plugin: ${String(err)}`);
    }
  }

  async function handleReload(plugin: InstalledPlugin) {
    try {
      const info = await pluginAddDevFolder(plugin.installPath); // re-read manifest
      const fresh = toInstalled(info);
      addDevPlugin(fresh);
      await pluginLoader.reloadPlugin(fresh.installPath, fresh.manifest);
      if (fresh.manifest.tiptapExtensions?.length) {
        showToast(
          `Reloaded ${fresh.manifest.name} — restart required for Tiptap extensions`,
        );
      } else {
        showToast(`Reloaded dev plugin: ${fresh.manifest.name}`);
      }
    } catch (err) {
      showToast(`Reload failed: ${String(err)}`);
    }
  }

  async function handleRemove(plugin: InstalledPlugin) {
    try {
      await pluginRemoveDevFolder(plugin.installPath);
      await pluginLoader.unloadPlugin(plugin.manifest.id);
      removeDevPlugin(plugin.manifest.id);
      showToast(`Removed dev plugin: ${plugin.manifest.name}`);
    } catch (err) {
      showToast(`Remove failed: ${String(err)}`);
    }
  }

  return (
    <section className="plugin-dev-section">
      <div className="flex-header">
        <h3>Developer</h3>
        <button className="icon-btn" onClick={handleLoad} type="button">
          Load dev plugin folder…
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-muted">
          No dev plugins loaded. Point at a folder with baram-plugin.json.
        </p>
      ) : (
        <ul className="plugin-dev-list">
          {list.map((p) => (
            <li className="plugin-dev-item" key={p.manifest.id}>
              <span className="text-truncate">{p.manifest.name}</span>
              <code className="text-truncate">{p.installPath}</code>
              <button
                className="icon-btn"
                onClick={() => handleReload(p)}
                type="button"
              >
                Reload
              </button>
              <button
                className="icon-btn"
                onClick={() => handleRemove(p)}
                type="button"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function toInstalled(r: {
  checksum: string;
  install_path: string;
  manifest: InstalledPlugin["manifest"];
}): InstalledPlugin {
  return {
    checksum: r.checksum,
    enabled: true,
    installedAt: 0,
    installPath: r.install_path,
    isDev: true,
    manifest: r.manifest,
    updatedAt: 0,
  };
}

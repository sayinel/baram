import type { InstalledPlugin } from "./types";

import { pluginListDev, pluginPrepareScopes } from "../ipc/plugin-invoke";
import { usePluginStore } from "../stores/system/plugin";
import { logger } from "../utils/logger";
import { emitPluginEvent } from "./extension-context";
// §69 Plugin Lifecycle — App-level plugin management
import { pluginLoader } from "./plugin-loader";

/** Initialize all enabled plugins at app startup. Budget: 200ms total. */
export async function initializePlugins(): Promise<void> {
  // Grant asset scope for ~/.baram/plugins before any load (see Global Constraints).
  await pluginPrepareScopes().catch((err) =>
    logger.error("[PluginLifecycle] prepare scopes failed:", err),
  );

  const { installedPlugins } = usePluginStore.getState();
  const enabledPlugins = Object.values(installedPlugins).filter(
    (p) => p.enabled,
  );

  if (enabledPlugins.length > 0) {
    const startTime = performance.now();

    // Sort by dependencies (simple topological sort)
    const sorted = sortByDependencies(enabledPlugins);

    // Load plugins in parallel (no dependency ordering for now since dependencies are rare)
    const results = await Promise.allSettled(
      sorted.map((plugin) =>
        pluginLoader
          .loadPlugin(plugin.installPath, plugin.manifest)
          .catch((err) => {
            logger.error(
              `[PluginLifecycle] Failed to load ${plugin.manifest.id}:`,
              err,
            );
            usePluginStore.getState().setError(plugin.manifest.id, String(err));
            throw err;
          }),
      ),
    );

    const loaded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;
    const elapsed = performance.now() - startTime;

    logger.info(
      `[PluginLifecycle] Loaded ${loaded} plugins (${failed} failed) in ${elapsed.toFixed(0)}ms`,
    );

    if (elapsed > 200) {
      logger.warn(
        `[PluginLifecycle] Plugin loading exceeded 200ms budget: ${elapsed.toFixed(0)}ms`,
      );
    }
  }

  // Dev plugins (source of truth = Rust config; not persisted in the store).
  try {
    const devRaw = await pluginListDev();
    const devPlugins: InstalledPlugin[] = devRaw.map((r) => ({
      checksum: r.checksum,
      enabled: true,
      installedAt: 0,
      installPath: r.install_path,
      isDev: true,
      manifest: r.manifest,
      updatedAt: 0,
    }));
    usePluginStore.getState().setDevPlugins(devPlugins);
    await Promise.allSettled(
      devPlugins.map((p) =>
        pluginLoader.loadPlugin(p.installPath, p.manifest).catch((err) => {
          logger.error(
            `[PluginLifecycle] dev load failed ${p.manifest.id}:`,
            err,
          );
          usePluginStore.getState().setError(p.manifest.id, String(err));
        }),
      ),
    );
  } catch (err) {
    logger.error("[PluginLifecycle] dev plugin init failed:", err);
  }
}

/** Called when the editor is ready */
export function notifyEditorReady(): void {
  emitPluginEvent("editor:ready");
}

/** Called when a file is opened in the editor */
export function notifyFileOpen(filePath: string): void {
  emitPluginEvent("file:open", filePath);
}

/** Called when a file is saved */
export function notifyFileSave(filePath: string): void {
  emitPluginEvent("file:save", filePath);
}

/** Cleanup all plugins on app shutdown */
export async function shutdownPlugins(): Promise<void> {
  await pluginLoader.unloadAll();
}

/** Simple topological sort by dependencies */
function sortByDependencies(plugins: InstalledPlugin[]): InstalledPlugin[] {
  const idSet = new Set(plugins.map((p) => p.manifest.id));
  const sorted: InstalledPlugin[] = [];
  const visited = new Set<string>();

  function visit(plugin: InstalledPlugin) {
    if (visited.has(plugin.manifest.id)) return;
    visited.add(plugin.manifest.id);

    // Visit dependencies first
    for (const dep of plugin.manifest.dependencies ?? []) {
      if (idSet.has(dep)) {
        const depPlugin = plugins.find((p) => p.manifest.id === dep);
        if (depPlugin) visit(depPlugin);
      }
    }
    sorted.push(plugin);
  }

  for (const plugin of plugins) {
    visit(plugin);
  }
  return sorted;
}

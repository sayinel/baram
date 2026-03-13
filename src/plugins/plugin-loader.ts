// §69 Plugin Loader — Dynamic ESM import with lifecycle management
import { convertFileSrc } from "@tauri-apps/api/core";

import type { LoadedPlugin, PluginManifest, PluginModule } from "./types";
import type { Extensions } from "@tiptap/core";

import { logger } from "../utils/logger";
import { createExtensionContext, setEditorInstance } from "./extension-context";
import { validateManifest } from "./manifest";

const ACTIVATE_TIMEOUT = 5000; // 5 seconds

export class PluginLoader {
  private loaded = new Map<string, LoadedPlugin>();

  /** Get all loaded plugins */
  getLoadedPlugins(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }

  /** Get Tiptap extensions from all loaded plugins */
  getTiptapExtensions(): Extensions {
    const extensions: Extensions = [];
    for (const plugin of this.loaded.values()) {
      if (!plugin.manifest.tiptapExtensions?.length) continue;
      for (const extDef of plugin.manifest.tiptapExtensions) {
        const ext = plugin.module[extDef.exportName];
        if (ext) {
          extensions.push(ext as Extensions[number]);
        } else {
          logger.warn(
            `[PluginLoader] Plugin ${plugin.id}: export "${extDef.exportName}" not found`,
          );
        }
      }
    }
    return extensions;
  }

  /** Check if a plugin is loaded */
  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  /** Load and activate a single plugin */
  async loadPlugin(
    installPath: string,
    manifest: PluginManifest,
  ): Promise<void> {
    if (this.loaded.has(manifest.id)) {
      logger.warn(`[PluginLoader] Plugin ${manifest.id} is already loaded`);
      return;
    }

    // 1. Validate manifest
    const validation = validateManifest(manifest);
    if (!validation.valid) {
      throw new Error(
        `Invalid manifest for ${manifest.id}: ${validation.errors.map((e) => e.message).join(", ")}`,
      );
    }

    // 2. Construct asset URL for the main entry
    const mainPath = `${installPath}/${manifest.main}`;
    const assetUrl = convertFileSrc(mainPath);

    // 3. Dynamic import
    let module: PluginModule;
    try {
      module = await import(/* @vite-ignore */ assetUrl);
    } catch (err) {
      throw new Error(`Failed to load plugin module ${manifest.id}: ${err}`);
    }

    // 4. Create extension context
    const context = createExtensionContext(manifest, installPath);

    // 5. Activate with timeout
    if (typeof module.activate === "function") {
      await withTimeout(
        Promise.resolve(module.activate(context)),
        ACTIVATE_TIMEOUT,
        `Plugin ${manifest.id} activation timed out after ${ACTIVATE_TIMEOUT}ms`,
      );
    }

    // 6. Store loaded plugin
    this.loaded.set(manifest.id, {
      id: manifest.id,
      manifest,
      module,
      context,
      disposables: context.subscriptions,
    });

    logger.info(
      `[PluginLoader] Loaded plugin: ${manifest.id} v${manifest.version}`,
    );
  }

  /** Update the editor instance for plugin editor API */
  setEditor(editor: unknown): void {
    setEditorInstance(editor);
  }

  /** Unload all plugins (reverse order) */
  async unloadAll(): Promise<void> {
    const ids = [...this.loaded.keys()].reverse();
    for (const id of ids) {
      await this.unloadPlugin(id);
    }
  }

  /** Unload and deactivate a plugin */
  async unloadPlugin(id: string): Promise<void> {
    const plugin = this.loaded.get(id);
    if (!plugin) return;

    // Call deactivate
    if (typeof plugin.module.deactivate === "function") {
      try {
        await withTimeout(
          Promise.resolve(plugin.module.deactivate()),
          1000,
          `Plugin ${id} deactivation timed out`,
        );
      } catch (err) {
        logger.error(`[PluginLoader] Error deactivating ${id}:`, err);
      }
    }

    // Dispose all disposables
    for (const disposable of plugin.disposables) {
      try {
        disposable.dispose();
      } catch (e) {
        logger.error(`[PluginLoader] Dispose error:`, e);
      }
    }

    this.loaded.delete(id);
    logger.info(`[PluginLoader] Unloaded plugin: ${id}`);
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Singleton instance */
export const pluginLoader = new PluginLoader();

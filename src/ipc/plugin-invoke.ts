// §69 Plugin Marketplace — IPC wrappers
import { invoke } from "@tauri-apps/api/core";

import type { PluginManifest, RegistryIndex } from "../plugins/types";

export interface RustInstalledPluginInfo {
  checksum: string;
  install_path: string;
  manifest: PluginManifest;
}

export async function pluginFetchRegistry(url: string): Promise<RegistryIndex> {
  return invoke<RegistryIndex>("plugin_fetch_registry", { url });
}

export async function pluginGetDir(): Promise<string> {
  return invoke<string>("plugin_get_dir");
}

export async function pluginInstall(
  url: string,
  checksum?: string,
): Promise<RustInstalledPluginInfo> {
  return invoke<RustInstalledPluginInfo>("plugin_install", {
    url,
    checksum: checksum ?? null,
  });
}

export async function pluginListInstalled(): Promise<
  RustInstalledPluginInfo[]
> {
  return invoke<RustInstalledPluginInfo[]>("plugin_list_installed");
}

export async function pluginReadManifest(
  pluginId: string,
): Promise<PluginManifest> {
  return invoke<PluginManifest>("plugin_read_manifest", { pluginId });
}

export async function pluginUninstall(pluginId: string): Promise<void> {
  return invoke<void>("plugin_uninstall", { pluginId });
}

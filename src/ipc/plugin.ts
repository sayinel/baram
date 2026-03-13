// §69 Plugin Marketplace IPC commands
import { invoke } from "@tauri-apps/api/core";

import type {
  InstalledPluginInfo,
  PluginManifest,
  RegistryIndex,
} from "./types";

export async function pluginFetchRegistry(url: string): Promise<RegistryIndex> {
  return invoke<RegistryIndex>("plugin_fetch_registry", { url });
}

export async function pluginGetDir(): Promise<string> {
  return invoke<string>("plugin_get_dir");
}

export async function pluginInstall(
  url: string,
  checksum?: string,
): Promise<InstalledPluginInfo> {
  return invoke<InstalledPluginInfo>("plugin_install", {
    url,
    checksum: checksum ?? null,
  });
}

export async function pluginListInstalled(): Promise<InstalledPluginInfo[]> {
  return invoke<InstalledPluginInfo[]>("plugin_list_installed");
}

export async function pluginReadManifest(
  pluginId: string,
): Promise<PluginManifest> {
  return invoke<PluginManifest>("plugin_read_manifest", { pluginId });
}

export async function pluginUninstall(pluginId: string): Promise<void> {
  return invoke<void>("plugin_uninstall", { pluginId });
}

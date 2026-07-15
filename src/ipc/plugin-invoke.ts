// §69 Plugin Marketplace — IPC wrappers
import { invoke } from "@tauri-apps/api/core";

import type {
  InstalledPlugin,
  PluginFetchInit,
  PluginFetchResponse,
  PluginManifest,
  RegistryIndex,
} from "../plugins/types";

export interface RustInstalledPluginInfo {
  checksum: string;
  install_path: string;
  is_dev?: boolean;
  manifest: PluginManifest;
}

export async function pluginAddDevFolder(
  path: string,
): Promise<RustInstalledPluginInfo> {
  return invoke<RustInstalledPluginInfo>("plugin_add_dev_folder", { path });
}

export async function pluginFetchRegistry(url: string): Promise<RegistryIndex> {
  return invoke<RegistryIndex>("plugin_fetch_registry", { url });
}

export async function pluginGetDir(): Promise<string> {
  return invoke<string>("plugin_get_dir");
}

export async function pluginHttpFetch(
  url: string,
  init?: PluginFetchInit,
): Promise<PluginFetchResponse> {
  return invoke<PluginFetchResponse>("plugin_http_fetch", { url, init });
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

export async function pluginListDev(): Promise<RustInstalledPluginInfo[]> {
  return invoke<RustInstalledPluginInfo[]>("plugin_list_dev");
}

export async function pluginListInstalled(): Promise<
  RustInstalledPluginInfo[]
> {
  return invoke<RustInstalledPluginInfo[]>("plugin_list_installed");
}

export async function pluginPrepareScopes(): Promise<void> {
  return invoke<void>("plugin_prepare_scopes");
}

export async function pluginReadManifest(
  pluginId: string,
): Promise<PluginManifest> {
  return invoke<PluginManifest>("plugin_read_manifest", { pluginId });
}

export async function pluginRemoveDevFolder(path: string): Promise<void> {
  return invoke<void>("plugin_remove_dev_folder", { path });
}

export async function pluginUninstall(pluginId: string): Promise<void> {
  return invoke<void>("plugin_uninstall", { pluginId });
}

/** Map a Rust-reported plugin info payload into a dev `InstalledPlugin`. */
export function toInstalledDevPlugin(
  r: RustInstalledPluginInfo,
): InstalledPlugin {
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

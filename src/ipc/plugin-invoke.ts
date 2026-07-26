// §69 Plugin Marketplace — IPC wrappers
import { invoke } from "@tauri-apps/api/core";
import type { Channel } from "@tauri-apps/api/core";

import type { PluginOp } from "../plugins/sandbox/plugin-op";
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

/** §260 sandbox broker — the only privileged channel a plugin-* window has. */
export async function pluginCall(op: PluginOp): Promise<unknown> {
  return invoke<unknown>("plugin_call", { op });
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

/**
 * §260 sandbox-only — hand the host an IPC channel for inbound (host→sandbox)
 * messages. Called once when the sandbox client boots; a `plugin-*` window has
 * no event permission, so this channel is its only way to receive anything.
 */
export async function pluginSandboxConnect<T>(
  channel: Channel<T>,
): Promise<void> {
  return invoke<void>("plugin_sandbox_connect", { channel });
}

/** §260 host-only — drop a sandbox plugin's registered capabilities. */
export async function pluginSandboxDeregister(pluginId: string): Promise<void> {
  return invoke<void>("plugin_sandbox_deregister", { pluginId });
}

/**
 * §260 host-only — register a sandbox plugin's granted capabilities together with
 * the directory the host resolved its manifest from. Binding both at once is what
 * keeps `source_read` returning the code that matches THIS manifest: a dev folder
 * legitimately shadows an installed copy of the same id, and Rust must not re-guess
 * which one won (§260 3c-2b review, I2).
 */
export async function pluginSandboxRegister(
  pluginId: string,
  capabilities: string[],
  installPath: string,
): Promise<void> {
  return invoke<void>("plugin_sandbox_register", {
    pluginId,
    capabilities,
    installPath,
  });
}

/**
 * §260 sandbox-only — the sandbox→host direction. Carries no plugin id: Rust
 * stamps it from the caller's window label, so one sandbox cannot impersonate
 * another on the host's `plugin:s2h` channel.
 */
export async function pluginSandboxReport(msg: unknown): Promise<void> {
  return invoke<void>("plugin_sandbox_report", { msg });
}

/** §260 host-only — deliver one message to a sandbox over its own IPC channel. */
export async function pluginSandboxSend(
  pluginId: string,
  msg: unknown,
): Promise<void> {
  return invoke<void>("plugin_sandbox_send", { pluginId, msg });
}

export async function pluginStorageList(pluginId: string): Promise<string[]> {
  return invoke<string[]>("plugin_storage_list", { pluginId });
}

export async function pluginStorageRead(
  pluginId: string,
  key: string,
): Promise<null | string> {
  return invoke<null | string>("plugin_storage_read", { pluginId, key });
}

export async function pluginStorageRemove(
  pluginId: string,
  key: string,
): Promise<void> {
  return invoke<void>("plugin_storage_remove", { pluginId, key });
}

export async function pluginStorageWrite(
  pluginId: string,
  key: string,
  value: string,
): Promise<void> {
  return invoke<void>("plugin_storage_write", { pluginId, key, value });
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

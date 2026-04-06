// §81 Context IPC wrappers
import { invoke } from "@tauri-apps/api/core";

import type { ContextInfo, VaultConfig } from "./types";

export async function addContext(info: ContextInfo): Promise<ContextInfo> {
  return invoke("add_context", { info });
}

/** §80 Retrieve all registered contexts from the Rust backend. */
export async function getContexts(): Promise<ContextInfo[]> {
  return invoke("get_contexts");
}

export async function getVaultConfig(
  contextId: string,
): Promise<null | VaultConfig> {
  return invoke("get_vault_config", { contextId });
}

/** §86 Load vault config directly by path (no context ID needed) */
export async function getVaultConfigByPath(path: string): Promise<VaultConfig> {
  return invoke("get_vault_config_by_path", { path });
}

export async function initVault(
  path: string,
  alias: string,
): Promise<VaultConfig> {
  return invoke("init_vault", { path, alias });
}

export async function removeContext(contextId: string): Promise<void> {
  return invoke("remove_context", { contextId });
}

/** §87 Resolve a cross-vault link target by alias + target name. */
export async function resolveCrossVaultLink(
  alias: string,
  target: string,
): Promise<null | string> {
  return invoke("resolve_cross_vault_link", { alias, target });
}

export async function setActiveContext(contextId: string): Promise<void> {
  return invoke("set_active_context", { contextId });
}

/** §86 Save vault config overrides to .baram/config.json */
export async function setVaultConfig(
  contextId: string,
  config: VaultConfig,
): Promise<void> {
  return invoke("set_vault_config", { contextId, config });
}

/** §86 Save vault config directly by path (no context ID needed) */
export async function setVaultConfigByPath(
  path: string,
  config: VaultConfig,
): Promise<void> {
  return invoke("set_vault_config_by_path", { path, config });
}

/** §88 Update alias for a context (syncs to Rust ContextManager). */
export async function updateContextAlias(
  contextId: string,
  alias: string,
): Promise<void> {
  return invoke("update_context_alias", { contextId, alias });
}

/** §88 Update color for a context. */
export async function updateContextColor(
  contextId: string,
  color: string,
): Promise<void> {
  return invoke("update_context_color", { contextId, color });
}

/** §88 Update label for a context. */
export async function updateContextLabel(
  contextId: string,
  label: string,
): Promise<void> {
  return invoke("update_context_label", { contextId, label });
}

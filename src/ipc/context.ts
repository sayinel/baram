// §81 Context IPC wrappers
import { invoke } from "@tauri-apps/api/core";

import type { ContextInfo, VaultConfig } from "./types";

export async function addContext(info: ContextInfo): Promise<ContextInfo> {
  return invoke("add_context", { info });
}

export async function getContexts(): Promise<ContextInfo[]> {
  return invoke("get_contexts");
}

export async function getVaultConfig(
  contextId: string,
): Promise<null | VaultConfig> {
  return invoke("get_vault_config", { contextId });
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

export async function setActiveContext(contextId: string): Promise<void> {
  return invoke("set_active_context", { contextId });
}

// §6.3 LLM IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { ModelInfo } from "./types";

export async function llmCancel(requestId: string): Promise<boolean> {
  return invoke<boolean>("llm_cancel", { requestId });
}

// §backlog #1 — no apiKey param: the Rust backend reads the provider's key from
// the OS keyring, so the key never crosses the IPC boundary with prompt content.
export async function llmComplete(
  prompt: string,
  model: string,
  requestId: string,
  systemPrompt?: string,
  maxTokens?: number,
  provider?: string,
  baseUrl?: string,
  privacyMode?: boolean,
): Promise<void> {
  return invoke<void>("llm_complete", {
    prompt,
    model,
    requestId,
    systemPrompt,
    maxTokens,
    provider,
    baseUrl,
    privacyMode,
  });
}

// §6.3 / §259 — no apiKey param: the backend reads the provider key from the OS
// keyring, so the secret never crosses the IPC boundary.
export async function llmListModels(
  provider: string,
  baseUrl?: string,
): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("llm_list_models", { provider, baseUrl });
}

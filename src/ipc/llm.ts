// §6.3 LLM IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { ModelInfo } from "./types";

export async function llmCancel(requestId: string): Promise<boolean> {
  return invoke<boolean>("llm_cancel", { requestId });
}

export async function llmComplete(
  apiKey: string,
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
    apiKey,
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

// §6.3 LLM commands
export async function llmListModels(
  provider: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("llm_list_models", { provider, apiKey, baseUrl });
}

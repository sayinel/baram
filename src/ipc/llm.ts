// §6.3 LLM IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { ModelInfo } from "./types";

/** What `llmComplete` rejects with when the request was cancelled — the
 *  Display of the Rust `LlmError::Cancelled`, which `llm_complete` passes
 *  through as the IPC error string (pinned by `test_error_display` in
 *  src-tauri/src/llm/mod.rs). A cancel is routine, not a failure, and it is
 *  the rejection itself that says so: whether the caller asked for a cancel
 *  proves nothing about a rejection that raced it (issue 265). */
export const LLM_CANCELLED_REJECTION = "Request cancelled";

/** The IPC rejection is the bare string; an Error carrying it as its message
 *  (a wrapper, a test double) counts too. Nothing else does — a real failure
 *  that raced the cancel arrives as its own text. */
export function isLLMCancelledRejection(reason: unknown): boolean {
  return (
    reason === LLM_CANCELLED_REJECTION ||
    (reason instanceof Error && reason.message === LLM_CANCELLED_REJECTION)
  );
}

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

// Shared LLM streaming setup utility
// Eliminates boilerplate from executeAICommand and executeBlockAIWithDiff
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type {
  LLMDonePayload,
  LLMErrorPayload,
  LLMTokenPayload,
} from "../ipc/types";

export interface LLMStreamCallbacks {
  onDone?(): void;
  onError?(error: string): void;
  onToken(token: string): void;
}

/**
 * Sets up llm:token / llm:done / llm:error listeners for a given requestId.
 * Returns a cleanup function that unregisters all 3 listeners.
 * Cleanup is also called automatically on done/error.
 */
export async function createLLMStream(
  requestId: string,
  callbacks: LLMStreamCallbacks,
): Promise<UnlistenFn> {
  const unlistens: UnlistenFn[] = [];

  const cleanup = () => {
    for (const un of unlistens) un();
    unlistens.length = 0;
  };

  const tokenUn = await listen<LLMTokenPayload>("llm:token", (event) => {
    if (event.payload.requestId !== requestId) return;
    callbacks.onToken(event.payload.token);
  });
  unlistens.push(tokenUn);

  const doneUn = await listen<LLMDonePayload>("llm:done", (event) => {
    if (event.payload.requestId !== requestId) return;
    cleanup();
    callbacks.onDone?.();
  });
  unlistens.push(doneUn);

  const errorUn = await listen<LLMErrorPayload>("llm:error", (event) => {
    if (event.payload.requestId !== requestId) return;
    cleanup();
    callbacks.onError?.(event.payload.error);
  });
  unlistens.push(errorUn);

  return cleanup;
}

import type { AIProvider, AITask } from "../stores/ai/ai";

// §6.3 Auto Model Selection — returns the appropriate model/provider for a given AI task
import { useAIStore } from "../stores/ai/ai";

export interface TaskConfig {
  baseUrl: string | undefined;
  /** Whether the resolved provider has an API key configured (§259 — the
   *  secret itself is never exposed to the frontend). */
  configured: boolean;
  model: string;
  provider: AIProvider;
}

/**
 * Resolves the effective provider, model, and base URL for a task, plus whether
 * that provider is configured. When autoModelEnabled is off, returns the main
 * (default) config. When on, uses per-task overrides with fallback to defaults.
 */
export function getConfigForTask(task: AITask): TaskConfig {
  const s = useAIStore.getState();

  if (!s.autoModelEnabled) {
    return {
      provider: s.provider,
      model: s.model,
      configured: s.configured[s.provider] ?? false,
      baseUrl: s.provider === "ollama" ? s.ollamaUrl : undefined,
    };
  }

  let tp: "" | AIProvider = "";
  let tm = "";
  switch (task) {
    case "agent":
      tp = s.providerForAgent;
      tm = s.modelForAgent;
      break;
    case "chat":
      tp = s.providerForChat;
      tm = s.modelForChat;
      break;
    case "ghost-text":
      tp = s.providerForGhostText;
      tm = s.modelForGhostText;
      break;
    case "inline-edit":
      tp = s.providerForInlineEdit;
      tm = s.modelForInlineEdit;
      break;
  }

  const provider = tp || s.provider;
  const model = tm || s.model;
  const configured = s.configured[provider] ?? false;
  const baseUrl = provider === "ollama" ? s.ollamaUrl : undefined;
  return { provider, model, configured, baseUrl };
}

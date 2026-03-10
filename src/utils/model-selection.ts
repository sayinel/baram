// §6.3 Auto Model Selection — returns the appropriate model/provider for a given AI task
import { useAIStore } from "../stores/ai-store";
import type { AIProvider, AITask } from "../stores/ai-store";

export interface TaskConfig {
  provider: AIProvider;
  model: string;
  apiKey: string;
  baseUrl: string | undefined;
}

/**
 * Resolves the effective provider, model, API key, and base URL for a task.
 * When autoModelEnabled is off, returns the main (default) config.
 * When on, uses per-task overrides with fallback to defaults.
 */
export function getConfigForTask(task: AITask): TaskConfig {
  const s = useAIStore.getState();

  if (!s.autoModelEnabled) {
    return {
      provider: s.provider,
      model: s.model,
      apiKey: s.apiKey,
      baseUrl: s.provider === "ollama" ? s.ollamaUrl : undefined,
    };
  }

  let tp: AIProvider | "" = "";
  let tm = "";
  switch (task) {
    case "ghost-text":
      tp = s.providerForGhostText;
      tm = s.modelForGhostText;
      break;
    case "inline-edit":
      tp = s.providerForInlineEdit;
      tm = s.modelForInlineEdit;
      break;
    case "chat":
      tp = s.providerForChat;
      tm = s.modelForChat;
      break;
    case "agent":
      tp = s.providerForAgent;
      tm = s.modelForAgent;
      break;
  }

  const provider = tp || s.provider;
  const model = tm || s.model;
  const apiKey = s.apiKeys[provider] ?? "";
  const baseUrl = provider === "ollama" ? s.ollamaUrl : undefined;
  return { provider, model, apiKey, baseUrl };
}

export function getModelForTask(task: AITask): string {
  return getConfigForTask(task).model;
}

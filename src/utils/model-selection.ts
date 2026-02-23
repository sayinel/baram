// §6.3 Auto Model Selection — returns the appropriate model for a given AI task
import { useAIStore } from "../stores/ai-store";
import type { AITask } from "../stores/ai-store";

export function getModelForTask(task: AITask): string {
  const store = useAIStore.getState();
  if (!store.autoModelEnabled) return store.model;

  switch (task) {
    case "ghost-text": return store.modelForGhostText || store.model;
    case "inline-edit": return store.modelForInlineEdit || store.model;
    case "chat": return store.modelForChat || store.model;
    case "agent": return store.modelForAgent || store.model;
  }
}

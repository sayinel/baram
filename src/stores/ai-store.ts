// §3.5 AI 상태 스토어 (§6.1)
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriStorage } from "./tauri-storage";

export type AIProvider = "claude" | "openai" | "ollama" | "gemini";

export interface CustomAICommand {
  id: string;
  name: string;
  prompt: string;
  icon?: string;
}

interface AIState {
  provider: AIProvider;
  model: string;
  /** Per-provider API keys */
  apiKeys: Record<string, string>;
  /** Computed getter: API key for the current provider */
  apiKey: string;
  ollamaUrl: string;
  privacyMode: boolean;
  isStreaming: boolean;
  ghostText: string | null;

  // M8 additions
  activeRequestId: string | null;
  ghostTextEnabled: boolean;
  ghostTextDebounceMs: number;
  maxSuggestionLength: number;
  customCommands: CustomAICommand[];

  setProvider: (provider: AIProvider) => void;
  setModel: (model: string) => void;
  setApiKey: (key: string) => void;
  setOllamaUrl: (url: string) => void;
  setPrivacyMode: (enabled: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  setGhostText: (text: string | null) => void;
  setActiveRequestId: (id: string | null) => void;
  setGhostTextEnabled: (enabled: boolean) => void;
  setGhostTextDebounceMs: (ms: number) => void;
  setMaxSuggestionLength: (len: number) => void;
  setCustomCommands: (cmds: CustomAICommand[]) => void;
  addCustomCommand: (cmd: CustomAICommand) => void;
  removeCustomCommand: (id: string) => void;
  updateCustomCommand: (id: string, updates: Partial<CustomAICommand>) => void;
}

export const useAIStore = create<AIState>()(persist((set) => ({
  provider: "claude",
  model: "claude-sonnet-4-5-20250929",
  apiKeys: {},
  apiKey: "",
  ollamaUrl: "http://localhost:11434",
  privacyMode: false,
  isStreaming: false,
  ghostText: null,
  activeRequestId: null,
  ghostTextEnabled: false,
  ghostTextDebounceMs: 500,
  maxSuggestionLength: 100,
  customCommands: [],

  setProvider: (provider) =>
    set((state) => ({
      provider,
      apiKey: state.apiKeys[provider] ?? "",
    })),
  setModel: (model) => set({ model }),
  setApiKey: (key) =>
    set((state) => ({
      apiKey: key,
      apiKeys: { ...state.apiKeys, [state.provider]: key },
    })),
  setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
  setPrivacyMode: (privacyMode) => set({ privacyMode }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setGhostText: (ghostText) => set({ ghostText }),
  setActiveRequestId: (activeRequestId) => set({ activeRequestId }),
  setGhostTextEnabled: (ghostTextEnabled) => set({ ghostTextEnabled }),
  setGhostTextDebounceMs: (ghostTextDebounceMs) => set({ ghostTextDebounceMs }),
  setMaxSuggestionLength: (maxSuggestionLength) => set({ maxSuggestionLength }),
  setCustomCommands: (customCommands) => set({ customCommands }),
  addCustomCommand: (cmd) =>
    set((state) => ({ customCommands: [...state.customCommands, cmd] })),
  removeCustomCommand: (id) =>
    set((state) => ({
      customCommands: state.customCommands.filter((c) => c.id !== id),
    })),
  updateCustomCommand: (id, updates) =>
    set((state) => ({
      customCommands: state.customCommands.map((c) =>
        c.id === id ? { ...c, ...updates } : c,
      ),
    })),
}), {
  name: "baram:ai-settings",
  version: 1,
  storage: createJSONStorage(() => tauriStorage),
  partialize: (state) => ({
    provider: state.provider,
    model: state.model,
    apiKeys: state.apiKeys,
    ollamaUrl: state.ollamaUrl,
    privacyMode: state.privacyMode,
    ghostTextEnabled: state.ghostTextEnabled,
    ghostTextDebounceMs: state.ghostTextDebounceMs,
    maxSuggestionLength: state.maxSuggestionLength,
    customCommands: state.customCommands,
  }),
  migrate: (persisted: unknown, version: number) => {
    const state = persisted as Record<string, unknown>;
    if (version === 0 || !version) {
      // v0 → v1: migrate single apiKey to per-provider apiKeys
      const oldKey = (state.apiKey as string) ?? "";
      const provider = (state.provider as string) ?? "claude";
      if (oldKey && !state.apiKeys) {
        state.apiKeys = { [provider]: oldKey };
      }
      delete state.apiKey;
    }
    return state as unknown as AIState;
  },
  onRehydrateStorage: () => (state) => {
    // After rehydration, sync apiKey from apiKeys[provider]
    if (state) {
      const key = state.apiKeys[state.provider] ?? "";
      if (state.apiKey !== key) {
        useAIStore.setState({ apiKey: key });
      }
    }
  },
}));

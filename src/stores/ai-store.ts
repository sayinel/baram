// §3.5 AI 상태 스토어 (§6.1)
import { create } from "zustand";

export type AIProvider = "claude" | "openai" | "ollama";

export interface CustomAICommand {
  id: string;
  name: string;
  prompt: string;
  icon?: string;
}

interface AIState {
  provider: AIProvider;
  model: string;
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

export const useAIStore = create<AIState>((set) => ({
  provider: "claude",
  model: "claude-sonnet-4-5-20250929",
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

  setProvider: (provider) => set({ provider }),
  setModel: (model) => set({ model }),
  setApiKey: (apiKey) => set({ apiKey }),
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
}));

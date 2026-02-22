// §3.5 AI 상태 스토어 (§6.1)
import { create } from "zustand";

type AIProvider = "claude" | "openai" | "ollama";

interface AIState {
  provider: AIProvider;
  model: string;
  apiKey: string;
  ollamaUrl: string;
  privacyMode: boolean;
  isStreaming: boolean;
  ghostText: string | null;

  setProvider: (provider: AIProvider) => void;
  setModel: (model: string) => void;
  setApiKey: (key: string) => void;
  setOllamaUrl: (url: string) => void;
  setPrivacyMode: (enabled: boolean) => void;
  setStreaming: (streaming: boolean) => void;
  setGhostText: (text: string | null) => void;
}

export const useAIStore = create<AIState>((set) => ({
  provider: "claude",
  model: "claude-sonnet-4-5-20250929",
  apiKey: "",
  ollamaUrl: "http://localhost:11434",
  privacyMode: false,
  isStreaming: false,
  ghostText: null,

  setProvider: (provider) => set({ provider }),
  setModel: (model) => set({ model }),
  setApiKey: (apiKey) => set({ apiKey }),
  setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
  setPrivacyMode: (privacyMode) => set({ privacyMode }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setGhostText: (ghostText) => set({ ghostText }),
}));

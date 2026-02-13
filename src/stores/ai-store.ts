// §3.5 AI 상태 스토어 (§6.1)
import { create } from "zustand";

type AIProvider = "claude" | "openai" | "ollama";

interface AIState {
  provider: AIProvider;
  model: string;
  apiKey: string;
  isStreaming: boolean;
  ghostText: string | null;

  setProvider: (provider: AIProvider) => void;
  setModel: (model: string) => void;
  setApiKey: (key: string) => void;
  setStreaming: (streaming: boolean) => void;
  setGhostText: (text: string | null) => void;
}

export const useAIStore = create<AIState>((set) => ({
  provider: "claude",
  model: "claude-sonnet-4-5-20250929",
  apiKey: "",
  isStreaming: false,
  ghostText: null,

  setProvider: (provider) => set({ provider }),
  setModel: (model) => set({ model }),
  setApiKey: (apiKey) => set({ apiKey }),
  setStreaming: (isStreaming) => set({ isStreaming }),
  setGhostText: (ghostText) => set({ ghostText }),
}));

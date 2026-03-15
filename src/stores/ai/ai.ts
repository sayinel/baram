// §3.5 AI 상태 스토어 (§6.1)
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { keyringGet, keyringStore } from "../../ipc/invoke";
import { logger } from "../../utils/logger";
import { tauriStorage } from "../system/tauri-storage";

export type AIProvider = "claude" | "gemini" | "ollama" | "openai";
export type AITask = "agent" | "chat" | "ghost-text" | "inline-edit";

const KEYRING_PROVIDERS: AIProvider[] = ["claude", "openai", "gemini"];

export interface CustomAICommand {
  icon?: string;
  id: string;
  name: string;
  prompt: string;
}

interface AIState {
  // M8 additions
  activeRequestId: null | string;
  addCustomCommand: (cmd: CustomAICommand) => void;
  /** Computed getter: API key for the current provider */
  apiKey: string;
  /** Per-provider API keys (in-memory only — persisted in OS keyring) */
  apiKeys: Record<string, string>;
  // Auto model selection
  autoModelEnabled: boolean;
  /** §44 Clipboard content captured for @clipboard reference */
  clipboardContent: string;
  customCommands: CustomAICommand[];
  ghostText: null | string;
  /** D3: Include open tab context in Ghost Text prompts */
  ghostTextCrossFileEnabled: boolean;

  ghostTextDebounceMs: number;
  ghostTextEnabled: boolean;
  isStreaming: boolean;
  keychainReady: boolean;
  loadApiKeysFromKeyring: () => Promise<void>;

  maxSuggestionLength: number;
  model: string;

  modelForAgent: string;
  modelForChat: string;
  modelForGhostText: string;
  modelForInlineEdit: string;
  ollamaUrl: string;
  privacyMode: boolean;
  provider: AIProvider;
  providerForAgent: "" | AIProvider;
  providerForChat: "" | AIProvider;

  providerForGhostText: "" | AIProvider;
  providerForInlineEdit: "" | AIProvider;
  removeCustomCommand: (id: string) => void;
  setActiveRequestId: (id: null | string) => void;
  setApiKey: (key: string) => void;
  setAutoModelEnabled: (enabled: boolean) => void;
  /** §44 Set clipboard content for @clipboard reference */
  setClipboardContent: (text: string) => void;
  setCustomCommands: (cmds: CustomAICommand[]) => void;
  setGhostText: (text: null | string) => void;
  setGhostTextCrossFileEnabled: (enabled: boolean) => void;
  setGhostTextDebounceMs: (ms: number) => void;
  setGhostTextEnabled: (enabled: boolean) => void;
  setMaxSuggestionLength: (len: number) => void;
  setModel: (model: string) => void;
  setModelForTask: (task: AITask, model: string) => void;
  setOllamaUrl: (url: string) => void;
  setPrivacyMode: (enabled: boolean) => void;
  setProvider: (provider: AIProvider) => void;
  setProviderForTask: (task: AITask, provider: "" | AIProvider) => void;
  setStreaming: (streaming: boolean) => void;
  updateCustomCommand: (id: string, updates: Partial<CustomAICommand>) => void;
}

function keyringKeyFor(provider: string): string {
  return `baram-${provider}-api-key`;
}

export const useAIStore = create<AIState>()(
  persist(
    (set) => ({
      provider: "claude",
      model: "claude-sonnet-4-5-20250929",
      apiKeys: {},
      apiKey: "",
      ollamaUrl: "http://localhost:11434",
      privacyMode: false,
      isStreaming: false,
      ghostText: null,
      keychainReady: false,
      activeRequestId: null,
      ghostTextEnabled: false,
      ghostTextDebounceMs: 500,
      maxSuggestionLength: 100,
      customCommands: [],
      clipboardContent: "",
      ghostTextCrossFileEnabled: true,
      autoModelEnabled: false,
      modelForGhostText: "",
      modelForInlineEdit: "",
      modelForChat: "",
      modelForAgent: "",
      providerForGhostText: "",
      providerForInlineEdit: "",
      providerForChat: "",
      providerForAgent: "",

      setProvider: (provider) =>
        set((state) => ({
          provider,
          apiKey: state.apiKeys[provider] ?? "",
        })),
      setModel: (model) => set({ model }),
      setApiKey: (key) => {
        // Update in-memory state immediately
        set((state) => ({
          apiKey: key,
          apiKeys: { ...state.apiKeys, [state.provider]: key },
        }));
        // Persist to OS keyring asynchronously
        const { provider } = useAIStore.getState();
        if (KEYRING_PROVIDERS.includes(provider)) {
          keyringStore(keyringKeyFor(provider), key).catch((err) => {
            logger.warn("[AI Store] Failed to save API key to keyring:", err);
          });
        }
      },
      setOllamaUrl: (ollamaUrl) => set({ ollamaUrl }),
      setPrivacyMode: (privacyMode) => set({ privacyMode }),
      setStreaming: (isStreaming) => set({ isStreaming }),
      setGhostText: (ghostText) => set({ ghostText }),
      setActiveRequestId: (activeRequestId) => set({ activeRequestId }),
      setGhostTextEnabled: (ghostTextEnabled) => set({ ghostTextEnabled }),
      setGhostTextDebounceMs: (ghostTextDebounceMs) =>
        set({ ghostTextDebounceMs }),
      setMaxSuggestionLength: (maxSuggestionLength) =>
        set({ maxSuggestionLength }),
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
      setAutoModelEnabled: (autoModelEnabled) => set({ autoModelEnabled }),
      setModelForTask: (task, model) => {
        switch (task) {
          case "agent":
            set({ modelForAgent: model });
            break;
          case "chat":
            set({ modelForChat: model });
            break;
          case "ghost-text":
            set({ modelForGhostText: model });
            break;
          case "inline-edit":
            set({ modelForInlineEdit: model });
            break;
        }
      },
      setProviderForTask: (task, provider) => {
        switch (task) {
          case "agent":
            set({ providerForAgent: provider });
            break;
          case "chat":
            set({ providerForChat: provider });
            break;
          case "ghost-text":
            set({ providerForGhostText: provider });
            break;
          case "inline-edit":
            set({ providerForInlineEdit: provider });
            break;
        }
      },
      setClipboardContent: (clipboardContent) => set({ clipboardContent }),
      setGhostTextCrossFileEnabled: (ghostTextCrossFileEnabled) =>
        set({ ghostTextCrossFileEnabled }),
      loadApiKeysFromKeyring: async () => {
        const loadedKeys: Record<string, string> = {};
        for (const provider of KEYRING_PROVIDERS) {
          try {
            const key = await keyringGet(keyringKeyFor(provider));
            if (key) {
              loadedKeys[provider] = key;
            }
          } catch {
            // Keyring access failed — skip this provider
          }
        }

        set((state) => {
          const mergedKeys = { ...state.apiKeys, ...loadedKeys };
          return {
            apiKeys: mergedKeys,
            apiKey: mergedKeys[state.provider] ?? state.apiKey,
            keychainReady: true,
          };
        });
      },
    }),
    {
      name: "baram:ai-settings",
      version: 3,
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        provider: state.provider,
        model: state.model,
        // apiKeys NO LONGER persisted to config.json — stored in OS keyring
        ollamaUrl: state.ollamaUrl,
        privacyMode: state.privacyMode,
        ghostTextEnabled: state.ghostTextEnabled,
        ghostTextDebounceMs: state.ghostTextDebounceMs,
        maxSuggestionLength: state.maxSuggestionLength,
        ghostTextCrossFileEnabled: state.ghostTextCrossFileEnabled,
        customCommands: state.customCommands,
        autoModelEnabled: state.autoModelEnabled,
        modelForGhostText: state.modelForGhostText,
        modelForInlineEdit: state.modelForInlineEdit,
        modelForChat: state.modelForChat,
        modelForAgent: state.modelForAgent,
        providerForGhostText: state.providerForGhostText,
        providerForInlineEdit: state.providerForInlineEdit,
        providerForChat: state.providerForChat,
        providerForAgent: state.providerForAgent,
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
        if (version <= 1) {
          // v1 → v2: migrate apiKeys from config.json → OS keyring
          // Keys found in persisted state will be migrated to keyring on rehydrate
          const apiKeys = state.apiKeys as Record<string, string> | undefined;
          if (apiKeys) {
            // Schedule migration after rehydration
            state._pendingKeyringMigration = apiKeys;
          }
          delete state.apiKeys;
        }
        if (version <= 2) {
          // v2 → v3: add per-task provider fields
          state.providerForGhostText = state.providerForGhostText ?? "";
          state.providerForInlineEdit = state.providerForInlineEdit ?? "";
          state.providerForChat = state.providerForChat ?? "";
          state.providerForAgent = state.providerForAgent ?? "";
        }
        return state as unknown as AIState;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;

        // Run keyring migration if pending (v1 → v2)
        const pendingMigration = (state as unknown as Record<string, unknown>)
          ._pendingKeyringMigration as Record<string, string> | undefined;
        if (pendingMigration) {
          // Migrate plaintext keys to keyring
          for (const [provider, key] of Object.entries(pendingMigration)) {
            if (key && KEYRING_PROVIDERS.includes(provider as AIProvider)) {
              keyringStore(keyringKeyFor(provider), key).catch(() => {});
            }
          }
          // Set in-memory while keyring loads
          useAIStore.setState((s) => ({
            apiKeys: { ...s.apiKeys, ...pendingMigration },
            apiKey: pendingMigration[s.provider] ?? s.apiKey,
          }));
          // Clean up migration flag
          delete (state as unknown as Record<string, unknown>)
            ._pendingKeyringMigration;
        }

        // Load keys from keyring
        useAIStore.getState().loadApiKeysFromKeyring();
      },
    },
  ),
);

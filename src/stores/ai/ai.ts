import type { KeyringProvider } from "../../ipc/invoke";

// §3.5 AI 상태 스토어 (§6.1)
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  keyringDeleteProviderKey,
  keyringProviderConfigured,
  keyringSetProviderKey,
} from "../../ipc/invoke";
import { logger } from "../../utils/logger";
import { tauriStorage } from "../system/tauri-storage";

export type AIProvider = "claude" | "gemini" | "ollama" | "openai";
export type AITask = "agent" | "chat" | "ghost-text" | "inline-edit";

const KEYRING_PROVIDERS: KeyringProvider[] = ["claude", "gemini", "openai"];

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
  // Auto model selection
  autoModelEnabled: boolean;
  /** §44 Clipboard content captured for @clipboard reference */
  clipboardContent: string;
  /** Which providers have an API key configured in the OS keyring (booleans
   *  only — the secret is never held in the frontend; §259). */
  configured: Partial<Record<AIProvider, boolean>>;
  customCommands: CustomAICommand[];
  ghostText: null | string;
  /** D3: Include open tab context in Ghost Text prompts */
  ghostTextCrossFileEnabled: boolean;

  ghostTextDebounceMs: number;
  ghostTextEnabled: boolean;
  isStreaming: boolean;
  keychainReady: boolean;

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
  /** Recompute `configured` from the OS keyring (booleans only). */
  refreshConfiguredProviders: () => Promise<void>;
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

function isKeyringProvider(p: string): p is KeyringProvider {
  return (KEYRING_PROVIDERS as string[]).includes(p);
}

export const useAIStore = create<AIState>()(
  persist(
    (set) => ({
      provider: "claude",
      model: "claude-sonnet-4-5-20250929",
      configured: {},
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

      setProvider: (provider) => set({ provider }),
      setModel: (model) => set({ model }),
      setApiKey: (key) => {
        // §259 — the secret is written straight to the OS keyring and never
        // held in frontend state; we only track whether it is configured.
        const { provider } = useAIStore.getState();
        if (!isKeyringProvider(provider)) return;
        const trimmed = key.trim();
        set((state) => ({
          configured: { ...state.configured, [provider]: trimmed.length > 0 },
        }));
        const op = trimmed
          ? keyringSetProviderKey(provider, key)
          : keyringDeleteProviderKey(provider);
        op.catch((err) => {
          logger.warn("[AI Store] Failed to update API key in keyring:", err);
        });
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
      refreshConfiguredProviders: async () => {
        const configured: Partial<Record<AIProvider, boolean>> = {};
        for (const provider of KEYRING_PROVIDERS) {
          try {
            configured[provider] = await keyringProviderConfigured(provider);
          } catch {
            // Keyring access failed — treat as not configured
            configured[provider] = false;
          }
        }
        set((state) => ({
          configured: { ...state.configured, ...configured },
          keychainReady: true,
        }));
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
          // Migrate any plaintext keys still in persisted config into the OS
          // keyring, then drop them from frontend state (§259). Refresh the
          // `configured` flags once the writes settle.
          const writes = Object.entries(pendingMigration)
            .filter(([provider, key]) => key && isKeyringProvider(provider))
            .map(([provider, key]) =>
              keyringSetProviderKey(provider as KeyringProvider, key).catch(
                () => {},
              ),
            );
          delete (state as unknown as Record<string, unknown>)
            ._pendingKeyringMigration;
          void Promise.all(writes).then(() =>
            useAIStore.getState().refreshConfiguredProviders(),
          );
          return;
        }

        // Derive which providers are configured (booleans only).
        useAIStore.getState().refreshConfiguredProviders();
      },
    },
  ),
);

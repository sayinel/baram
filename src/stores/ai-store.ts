// §3.5 AI 상태 스토어 (§6.1)
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriStorage } from "./tauri-storage";
import { keyringStore, keyringGet } from "../ipc/invoke";

export type AIProvider = "claude" | "openai" | "ollama" | "gemini";
export type AITask = "ghost-text" | "inline-edit" | "chat" | "agent";

const KEYRING_PROVIDERS: AIProvider[] = ["claude", "openai", "gemini"];

function keyringKeyFor(provider: string): string {
  return `baram-${provider}-api-key`;
}

export interface CustomAICommand {
  id: string;
  name: string;
  prompt: string;
  icon?: string;
}

interface AIState {
  provider: AIProvider;
  model: string;
  /** Per-provider API keys (in-memory only — persisted in OS keyring) */
  apiKeys: Record<string, string>;
  /** Computed getter: API key for the current provider */
  apiKey: string;
  ollamaUrl: string;
  privacyMode: boolean;
  isStreaming: boolean;
  ghostText: string | null;
  keychainReady: boolean;

  // M8 additions
  activeRequestId: string | null;
  ghostTextEnabled: boolean;
  ghostTextDebounceMs: number;
  maxSuggestionLength: number;
  customCommands: CustomAICommand[];

  /** §44 Clipboard content captured for @clipboard reference */
  clipboardContent: string;
  /** D3: Include open tab context in Ghost Text prompts */
  ghostTextCrossFileEnabled: boolean;

  // Auto model selection
  autoModelEnabled: boolean;
  modelForGhostText: string;
  modelForInlineEdit: string;
  modelForChat: string;
  modelForAgent: string;

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
  setAutoModelEnabled: (enabled: boolean) => void;
  setModelForTask: (task: AITask, model: string) => void;
  loadApiKeysFromKeyring: () => Promise<void>;
  /** §44 Set clipboard content for @clipboard reference */
  setClipboardContent: (text: string) => void;
  setGhostTextCrossFileEnabled: (enabled: boolean) => void;
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
            console.warn("[AI Store] Failed to save API key to keyring:", err);
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
          case "ghost-text":
            set({ modelForGhostText: model });
            break;
          case "inline-edit":
            set({ modelForInlineEdit: model });
            break;
          case "chat":
            set({ modelForChat: model });
            break;
          case "agent":
            set({ modelForAgent: model });
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
      version: 2,
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

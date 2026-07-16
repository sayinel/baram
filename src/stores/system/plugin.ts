import type { InstalledPlugin, RegistryIndex } from "../../plugins/types";

// §69 Plugin Marketplace — Plugin State Store
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { tauriStorage } from "./tauri-storage";

interface PluginState {
  // Actions
  addDevPlugin: (plugin: InstalledPlugin) => void;
  addPlugin: (plugin: InstalledPlugin) => void;
  clearUpdateAvailable: (id: string) => void;
  // Runtime state (not persisted; Rust config is the source of truth)
  devPlugins: Record<string, InstalledPlugin>;
  getPluginSettings: (pluginId: string) => Record<string, unknown>;

  // Persisted state
  installedPlugins: Record<string, InstalledPlugin>;
  installing: Record<string, boolean>;
  // Runtime state (not persisted)
  pluginErrors: Record<string, string>;
  pluginSettings: Record<string, Record<string, unknown>>;
  registryCache: null | RegistryIndex;

  registryCacheTime: number;
  registryUrl: string;
  removeDevPlugin: (id: string) => void;
  removePlugin: (id: string) => void;
  setDevPlugins: (list: InstalledPlugin[]) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  setError: (id: string, error: null | string) => void;
  setInstalling: (id: string, installing: boolean) => void;
  setPluginSetting: (pluginId: string, key: string, value: unknown) => void;
  setRegistryCache: (index: RegistryIndex) => void;
  setRegistryUrl: (url: string) => void;
  setUpdateAvailable: (id: string, version: string) => void;
  updateAvailable: Record<string, string>; // pluginId -> latest version
  updatePluginVersion: (id: string, version: string, checksum: string) => void;
}

export const DEFAULT_REGISTRY_URL =
  "https://sayinel.github.io/baram-plugins/index.json";

// §69 The registry moved off the dead baram-community repo. Any app that
// ever ran (including the published v0.3.0) may have this old URL persisted,
// which would otherwise shadow DEFAULT_REGISTRY_URL forever on rehydration.
export const OLD_DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/baram-community/plugin-registry/main/index.json";

/**
 * v1 -> v2: rewrite a persisted `registryUrl` that still points at the dead
 * baram-community registry to the live DEFAULT_REGISTRY_URL. Any other value
 * (including custom registry URLs) is preserved unchanged. Defensive against
 * malformed/missing persisted state — returns it untouched rather than
 * throwing, matching Zustand's expectation that migrate never throws.
 */
export function migratePluginPersistedState(
  persisted: unknown,
  version: number,
): unknown {
  if (persisted === null || typeof persisted !== "object") {
    return persisted;
  }
  const state = persisted as Record<string, unknown>;

  // v0/v1 -> v2: dead registry default -> live registry default
  if (version < 2 && state.registryUrl === OLD_DEFAULT_REGISTRY_URL) {
    state.registryUrl = DEFAULT_REGISTRY_URL;
  }

  return state;
}

/** Remove a key from an object, returning a new object without it */
function omitKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => k !== key),
  ) as T;
}

export const usePluginStore = create<PluginState>()(
  persist(
    (set, get) => ({
      // Persisted
      installedPlugins: {},
      pluginSettings: {},
      registryUrl: DEFAULT_REGISTRY_URL,

      // Runtime
      pluginErrors: {},
      registryCache: null,
      registryCacheTime: 0,
      updateAvailable: {},
      installing: {},
      devPlugins: {},

      setDevPlugins: (list) =>
        set({
          devPlugins: Object.fromEntries(list.map((p) => [p.manifest.id, p])),
        }),

      addDevPlugin: (plugin) =>
        set((state) => ({
          devPlugins: { ...state.devPlugins, [plugin.manifest.id]: plugin },
        })),

      removeDevPlugin: (id) =>
        set((state) => ({ devPlugins: omitKey(state.devPlugins, id) })),

      addPlugin: (plugin) =>
        set((state) => ({
          installedPlugins: {
            ...state.installedPlugins,
            [plugin.manifest.id]: plugin,
          },
        })),

      removePlugin: (id) =>
        set((state) => ({
          installedPlugins: omitKey(state.installedPlugins, id),
          pluginSettings: omitKey(state.pluginSettings, id),
          pluginErrors: omitKey(state.pluginErrors, id),
        })),

      setEnabled: (id, enabled) =>
        set((state) => {
          const plugin = state.installedPlugins[id];
          if (!plugin) return state;
          return {
            installedPlugins: {
              ...state.installedPlugins,
              [id]: { ...plugin, enabled },
            },
          };
        }),

      setError: (id, error) =>
        set((state) => {
          if (error === null) {
            return { pluginErrors: omitKey(state.pluginErrors, id) };
          }
          return { pluginErrors: { ...state.pluginErrors, [id]: error } };
        }),

      setInstalling: (id, installing) =>
        set((state) => {
          if (!installing) {
            return { installing: omitKey(state.installing, id) };
          }
          return { installing: { ...state.installing, [id]: true } };
        }),

      updatePluginVersion: (id, version, checksum) =>
        set((state) => {
          const plugin = state.installedPlugins[id];
          if (!plugin) return state;
          return {
            installedPlugins: {
              ...state.installedPlugins,
              [id]: {
                ...plugin,
                manifest: { ...plugin.manifest, version },
                checksum,
                updatedAt: Date.now(),
              },
            },
          };
        }),

      setRegistryCache: (index) =>
        set({
          registryCache: index,
          registryCacheTime: Date.now(),
        }),

      setUpdateAvailable: (id, version) =>
        set((state) => ({
          updateAvailable: { ...state.updateAvailable, [id]: version },
        })),

      clearUpdateAvailable: (id) =>
        set((state) => ({
          updateAvailable: omitKey(state.updateAvailable, id),
        })),

      setPluginSetting: (pluginId, key, value) =>
        set((state) => ({
          pluginSettings: {
            ...state.pluginSettings,
            [pluginId]: {
              ...(state.pluginSettings[pluginId] ?? {}),
              [key]: value,
            },
          },
        })),

      getPluginSettings: (pluginId) => get().pluginSettings[pluginId] ?? {},

      setRegistryUrl: (registryUrl) => set({ registryUrl }),
    }),
    {
      name: "baram:plugins",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        installedPlugins: state.installedPlugins,
        pluginSettings: state.pluginSettings,
        registryUrl: state.registryUrl,
      }),
      version: 2,
      migrate: migratePluginPersistedState,
    },
  ),
);

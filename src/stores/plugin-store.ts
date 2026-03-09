// §69 Plugin Marketplace — Plugin State Store
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriStorage } from "./tauri-storage";
import type { InstalledPlugin, RegistryIndex } from "../plugins/types";

interface PluginState {
  // Persisted state
  installedPlugins: Record<string, InstalledPlugin>;
  pluginSettings: Record<string, Record<string, unknown>>;
  registryUrl: string;

  // Runtime state (not persisted)
  pluginErrors: Record<string, string>;
  registryCache: RegistryIndex | null;
  registryCacheTime: number;
  updateAvailable: Record<string, string>; // pluginId -> latest version
  installing: Record<string, boolean>;

  // Actions
  addPlugin: (plugin: InstalledPlugin) => void;
  removePlugin: (id: string) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  setError: (id: string, error: string | null) => void;
  setInstalling: (id: string, installing: boolean) => void;
  updatePluginVersion: (id: string, version: string, checksum: string) => void;
  setRegistryCache: (index: RegistryIndex) => void;
  setUpdateAvailable: (id: string, version: string) => void;
  clearUpdateAvailable: (id: string) => void;
  setPluginSetting: (pluginId: string, key: string, value: unknown) => void;
  getPluginSettings: (pluginId: string) => Record<string, unknown>;
  setRegistryUrl: (url: string) => void;
}

const DEFAULT_REGISTRY_URL =
  "https://raw.githubusercontent.com/baram-community/plugin-registry/main/index.json";

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
      version: 1,
    },
  ),
);

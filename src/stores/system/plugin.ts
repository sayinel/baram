import type { RevocationList } from "../../plugins/revocation";
import type {
  InstalledPlugin,
  PluginCapability,
  PluginConsent,
  RegistryIndex,
} from "../../plugins/types";

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
  /** §69 Persisted: revocation must survive offline, so it is not a fetch cache. */
  revocations: null | RevocationList;
  revocationsFetchedAt: number;
  setDevPlugins: (list: InstalledPlugin[]) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  setError: (id: string, error: null | string) => void;
  setInstalling: (id: string, installing: boolean) => void;
  setPluginSetting: (pluginId: string, key: string, value: unknown) => void;
  setRegistryCache: (index: RegistryIndex) => void;
  setRegistryUrl: (url: string) => void;
  setRevocations: (list: RevocationList) => void;
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
 * (including custom registry URLs) is preserved unchanged.
 *
 * v2 -> v3: §260 Phase 5 — give every installed plugin the consent record the
 * install flow now writes.
 *
 * Defensive against malformed/missing persisted state at every step — returns it
 * untouched rather than throwing, matching Zustand's expectation that migrate never
 * throws.
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

  if (version < 3) {
    backfillConsent(state.installedPlugins);
  }

  return state;
}

/**
 * §260 Phase 5 — synthesise `consent` for records installed before the consent step.
 *
 * Using the installed manifest as the baseline is honest rather than merely convenient:
 * these records went through the old capability confirm. Inventing a wider consent would
 * silence a real escalation; inventing a narrower one would prompt on every update.
 *
 * A legacy (trust-less) manifest is skipped deliberately. There is no tier to record,
 * and `validateManifest` refuses to load it anyway, so "never consented" is both true
 * and the safe default — the next update asks.
 *
 * ‼️ This used to justify the baseline by claiming such records "can only exist in a dev
 * build at all, because release had plugins gated off (#259)". The v0.5.0 release review
 * disproved it: the #259 gate merged 2026-07-23, two days AFTER v0.4.1 was tagged, so it
 * shipped in NO release — v0.4.0 and v0.4.1 both had the marketplace open against the live
 * registry.
 *
 * Every v0.4.x install is nonetheless trust-less, so all of them take the skip below and only
 * §260-era dev installs are backfilled. The mechanism is NOT that v0.4.1's `manifest.ts` did
 * not validate `trust` — a validator that ignores a field does not strip it, and the second
 * re-review round rightly called that a non-sequitur. It is that v0.4.1's **Rust**
 * `PluginManifest` struct had no `trust` member at all, so `serde_json` dropped the field
 * during the install hop and `PluginMarketplace` persisted the stripped object. `trust` could
 * not survive into a v0.4.x record whatever the ZIP declared. That is the same
 * deserialize-then-re-serialize erasure §260 already hit twice on the registry index — the
 * reason to name it here is that a reader who spots the bogus validator argument would
 * conclude the behaviour is unproven and "fix" it.
 */
function backfillConsent(installedPlugins: unknown): void {
  if (installedPlugins === null || typeof installedPlugins !== "object") return;

  for (const entry of Object.values(
    installedPlugins as Record<string, unknown>,
  )) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (record.consent !== undefined) continue;

    const manifest = record.manifest as
      undefined | { capabilities?: unknown; trust?: unknown };
    const trust = manifest?.trust;
    if (trust !== "sandboxed" && trust !== "trusted") continue;

    record.consent = {
      // Copied, not aliased: the consent is the fixed record of what the user agreed
      // to, so a later manifest rewrite must not reach through and edit it.
      capabilities: Array.isArray(manifest?.capabilities)
        ? [...(manifest.capabilities as PluginCapability[])]
        : [],
      trust,
    } satisfies PluginConsent;
  }
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
      revocations: null,
      revocationsFetchedAt: 0,
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
        set((state) => ({
          devPlugins: omitKey(state.devPlugins, id),
          // §260 Phase 4c code review (L10) — like `removePlugin`. `pluginSettings` is
          // PERSISTED, so without this a dev-folder churn accumulates records forever.
          // Invisible while it lasts (the resolver drops undeclared keys), which is exactly
          // why nothing would ever have noticed.
          pluginSettings: omitKey(state.pluginSettings, id),
        })),

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

      // §69 — the stored withdrawal list belongs to the registry it came from. Keeping
      // it across a switch means our list keeps governing someone else's plugins, and a
      // self-hosted registry will normally 404 on `revoked.json`, so "until the next
      // successful fetch" would in practice be "forever".
      setRegistryUrl: (registryUrl) =>
        set({ registryUrl, revocations: null, revocationsFetchedAt: 0 }),

      setRevocations: (revocations) =>
        set({ revocations, revocationsFetchedAt: Date.now() }),
    }),
    {
      name: "baram:plugins",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        installedPlugins: state.installedPlugins,
        pluginSettings: state.pluginSettings,
        registryUrl: state.registryUrl,
        // §69 Persisted deliberately, unlike `registryCache`. A revocation the user
        // has already received must keep applying with the network gone, or blocking
        // network access would be enough to undo it. No migration step: an absent key
        // falls back to the initial `null`, which is the correct pre-first-fetch state.
        revocations: state.revocations,
        revocationsFetchedAt: state.revocationsFetchedAt,
      }),
      version: 3,
      migrate: migratePluginPersistedState,
    },
  ),
);

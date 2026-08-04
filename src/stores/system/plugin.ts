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
  /**
   * Highest revocation `sequence` accepted THIS SESSION, per registry URL.
   *
   * ‼️ IN MEMORY ONLY — see the `partialize` block for why persisting it was a defect, and
   * for what that costs. In short: a persisted mark is a durable primitive an in-realm
   * attacker can set once to refuse every genuine list forever, and it blocks the repair that
   * makes a poisoned stored list survivable.
   *
   * ‼️ SEPARATE FROM `revocations` BECAUSE `setRegistryUrl` CLEARS THAT (security review
   * MEDIUM-1). Clearing the list on a switch is right — ours must not govern someone else's
   * plugins — but it also erased the high-water mark, so switching to another registry and
   * back accepted anything at or above the floor. An attacker serving the origin could then
   * replay an old signed list on the return trip, which is the exact rollback the counter
   * exists to refuse. Within a session that hole is still closed; across a restart the
   * compiled `MINIMUM_REVOCATION_SEQUENCE` is what stands.
   *
   * Keyed by registry URL so each registry keeps its own mark, and not cleared by
   * `setRegistryUrl`: the point is to remember a number a registry has already reached.
   */
  revocationSequenceSeen: Record<string, number>;
  revocationsFetchedAt: number;
  setDevPlugins: (list: InstalledPlugin[]) => void;
  setEnabled: (id: string, enabled: boolean) => void;
  setError: (id: string, error: null | string) => void;
  setInstalling: (id: string, installing: boolean) => void;
  setPluginSetting: (pluginId: string, key: string, value: unknown) => void;
  setRegistryCache: (index: RegistryIndex) => void;
  setRegistryUrl: (url: string) => void;
  /**
   * Store a fetched list. `verified` says whether its signature was checked.
   *
   * ‼️ REQUIRED, NOT OPTIONAL, and it gates the high-water mark. An unverified counter must
   * never raise the floor — see `revocationSequenceSeen`. A default of `true` would make the
   * dangerous case the one you get by forgetting the argument.
   */
  setRevocations: (list: RevocationList, verified: boolean) => void;
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
      revocationSequenceSeen: {},
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

      // ‼️ The high-water mark is raised HERE and never lowered, and it deliberately outlives
      // `setRegistryUrl` above. `Math.max` rather than assignment: accepting an equal counter
      // is normal (every refresh), and a caller must not be able to walk the mark down by
      // storing an older list.
      setRevocations: (revocations, verified) =>
        set((state) => ({
          revocations,
          // ‼️ RAISED ONLY BY A VERIFIED LIST (code review CRITICAL-1). Corrected from an
          // earlier version of this comment that said "this value is persisted": it is NOT —
          // see `partialize` and `merge` below, and that mistaken belief is what produced the
          // defect in the first place. Within a session the mark is still a ceiling, so an
          // unverified counter must not raise it: a `trusted` plugin answering the refresh can
          // otherwise refuse every genuine list until the app restarts. `verified` does not
          // stop that plugin (it writes the flag too) — it stops the NETWORK attacker.
          revocationSequenceSeen: verified
            ? {
                ...state.revocationSequenceSeen,
                [state.registryUrl]: Math.max(
                  state.revocationSequenceSeen[state.registryUrl] ?? 0,
                  revocations.sequence,
                ),
              }
            : state.revocationSequenceSeen,
          revocationsFetchedAt: Date.now(),
        })),
    }),
    {
      name: "baram:plugins",
      storage: createJSONStorage(() => tauriStorage),
      partialize: (state) => ({
        installedPlugins: state.installedPlugins,
        pluginSettings: state.pluginSettings,
        // ‼️ `registryUrl` IS DELIBERATELY ABSENT — see `merge`, which is what makes that true.
        //
        // It was persisted, and a security review showed it was a STRONGER durable primitive
        // than the revocation mark ever was. `setRegistryUrl` has no callers anywhere in the
        // app and no UI field, so nothing but an in-realm attacker (or a hand-edited config)
        // ever changed it — and one call was permanent: the same call clears `revocations`
        // (immediate fail-open), the value survived the restart, and the startup refresh then
        // fetched the ATTACKER's origin. Rust sees a non-first-party prefix there, so it does
        // not even ask for a signature and reports `verified: false`, and the attacker's empty
        // list is stored and governs the gate. Unlike the mark it did not self-heal, because
        // the fetch that would heal it was the one aimed at the attacker, and unlike the mark
        // arming verification did not touch it.
        //
        // Not persisting it makes that session-scoped: the next launch resolves the first-party
        // registry, the genuine list lands, and the poisoned stored list is replaced. USER
        // DECISION (2026-08-04): the cost — a custom registry would not survive a restart — is
        // accepted, since there is no UI to set one and therefore no user who has one.
        // §69 Persisted deliberately, unlike `registryCache`. A revocation the user
        // has already received must keep applying with the network gone, or blocking
        // network access would be enough to undo it. No migration step: an absent key
        // falls back to the initial `null`, which is the correct pre-first-fetch state.
        revocations: state.revocations,
        revocationsFetchedAt: state.revocationsFetchedAt,
        // ‼️ `revocationSequenceSeen` IS DELIBERATELY ABSENT — it stays in memory only.
        //
        // It was persisted for one round, and that was a defect of mine (code review
        // CRITICAL-1, second attempt): a PERSISTED MARK BLOCKS THE VERY REPAIR THAT MAKES A
        // POISONED LIST SURVIVABLE. The attack `plugin-lifecycle.ts` documents — a `trusted`
        // plugin answering the refresh with an empty list that then gets stored — heals at the
        // next genuine fetch, because a real list simply replaces the stored one. A mark of
        // 1,000,000 stops that: every genuine list is below it, so it is refused, and the
        // poisoned empty list stays forever. Persisting the mark turned a self-healing session
        // attack into a permanent one, which is strictly worse than not having the counter.
        //
        // Moving the mark into Rust would NOT have fixed it: a trusted plugin runs in the
        // `main` realm and `capabilities/default.json` grants that realm `allow-set-config`
        // and `allow-export-binary-file`, so the same attacker writes any file we could put it
        // in. There is no containing the trusted tier from inside it — §260 defines that tier
        // as full trust behind an install-time consent gate. What CAN be refused is a durable
        // primitive.
        //
        // ‼️ AND OMITTING IT HERE IS NOT ENOUGH, which is what the next round found (code
        // review CRITICAL-1, third attempt). See `merge` below: this list governs what the app
        // WRITES, and rehydration restores whatever storage HOLDS.
        //
        // What is lost: across a restart, replay protection falls back to
        // `MINIMUM_REVOCATION_SEQUENCE`, the floor compiled into the build. So a replay of a
        // genuinely-published list that is newer than the floor but older than what this
        // session saw would be accepted after a restart — and note that nothing yet FAILS when
        // a release forgets to raise the floor, so treat that bound as an intention.
      }),
      // ‼️ THE READ SIDE, AND IT IS A SEPARATE DECISION FROM `partialize` (code review
      // CRITICAL-1, third attempt). zustand's default merge is
      // `{...currentState, ...persistedState}`, so ANY key present in storage is restored into
      // memory whether `partialize` would have written it or not. Omitting the mark above
      // therefore removed only this app's PARTICIPATION in persisting it, not its durability.
      //
      // The attacker does not need to go through this app at all: `tauriStorage` is
      // `get_config`/`set_config`, and `capabilities/default.json` grants the `main` realm
      // `allow-set-config`. So a consented trusted plugin reads `baram:plugins`, splices in
      // `revocationSequenceSeen: {<registry>: 1000000}`, writes it back and uninstalls itself.
      // No race and no patched `invoke`. Reproduced: the mark returned on rehydrate and the
      // genuine list at sequence 2 was refused, on every launch, for every plugin.
      //
      // Forcing it here makes "in memory only" true of the READ path, which is the only place
      // it can be made true. No `version` bump or migrate step: a key left in storage is now
      // inert, and `partialize` drops it on the next write.
      // ‼️ BOTH RESETS LIVE HERE, because this is the only side that can make them true.
      // Omitting a key from `partialize` above stops this app from WRITING it and does nothing
      // about a value already in storage — which is the mistake this feature made twice.
      // `current` is the initial state, so naming it is how each field says "keep the default,
      // whatever the default becomes".
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as object),
        registryUrl: current.registryUrl,
        revocationSequenceSeen: {},
      }),
      version: 3,
      migrate: migratePluginPersistedState,
    },
  ),
);

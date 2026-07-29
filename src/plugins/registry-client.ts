import type { PluginTrust, RegistryEntry, RegistryIndex } from "./types";

import { pluginFetchRegistry } from "../ipc/plugin-invoke";
// §69 Plugin Registry Client — GitHub-based registry with 24h cache
import { usePluginStore } from "../stores/system/plugin";
import { logger } from "../utils/logger";

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

const TRUST_VALUES: readonly PluginTrust[] = ["sandboxed", "trusted"];

/** Check for updates for all installed plugins */
export async function checkForUpdates(): Promise<Record<string, string>> {
  const store = usePluginStore.getState();
  const index = await fetchRegistryIndex();
  const updates: Record<string, string> = {};

  for (const [id, plugin] of Object.entries(store.installedPlugins)) {
    const registryEntry = index.plugins.find((p) => p.id === id);
    if (registryEntry && registryEntry.version !== plugin.manifest.version) {
      updates[id] = registryEntry.version;
      store.setUpdateAvailable(id, registryEntry.version);
    }
  }

  return updates;
}

/** Fetch registry index, using cache if fresh */
export async function fetchRegistryIndex(
  forceRefresh = false,
): Promise<RegistryIndex> {
  const store = usePluginStore.getState();

  // Check cache
  if (
    !forceRefresh &&
    store.registryCache &&
    Date.now() - store.registryCacheTime < CACHE_DURATION
  ) {
    return store.registryCache;
  }

  // Fetch from remote via Rust IPC
  try {
    // Normalized BEFORE caching, so every later reader (install, update check, search) sees
    // one shape and the guard cannot be bypassed by reading the cache instead.
    const index = normalizeIndex(await pluginFetchRegistry(store.registryUrl));
    store.setRegistryCache(index);
    return index;
  } catch (err) {
    // If fetch fails and we have stale cache, return it
    if (store.registryCache) {
      logger.warn("[Registry] Fetch failed, using stale cache:", err);
      return store.registryCache;
    }
    throw err;
  }
}

/** Search registry plugins by query */
export function searchRegistry(
  index: RegistryIndex,
  query: string,
): RegistryEntry[] {
  if (!query.trim()) return index.plugins;

  const lower = query.toLowerCase();
  return index.plugins.filter(
    (p) =>
      p.name.toLowerCase().includes(lower) ||
      p.description.toLowerCase().includes(lower) ||
      p.id.toLowerCase().includes(lower) ||
      p.keywords?.some((k) => k.toLowerCase().includes(lower)) ||
      p.author.toLowerCase().includes(lower),
  );
}

/**
 * §260 Phase 6 — drop a `trust` this app does not recognise.
 *
 * `RegistryEntry.trust` is typed `PluginTrust`, but nothing checks that at runtime: the
 * value comes from a remote JSON file, passes through Rust as an `Option<String>` (a pipe,
 * deliberately not a validator), and is then handed to `PluginConsentDialog` as the tier the
 * user is approving. An unknown string would therefore be *displayed* as a tier and stored
 * as consent while matching neither branch of any `trust === "trusted"` check — i.e. it
 * would silently behave as the weaker tier.
 *
 * Failing closed means becoming LEGACY: Install is disabled and the marketplace already
 * explains why, which is the right answer for "this entry names a tier I cannot enforce".
 */
function normalizeIndex(index: RegistryIndex): RegistryIndex {
  return {
    ...index,
    plugins: index.plugins.map((entry) => {
      if (entry.trust === undefined || TRUST_VALUES.includes(entry.trust)) {
        return entry;
      }
      logger.warn(
        `[Registry] ${entry.id} declares an unknown trust tier ${JSON.stringify(
          entry.trust,
        )} — treating the entry as legacy (not installable)`,
      );
      // Deleted rather than destructured away: this project's lint ignores `^_` for
      // arguments only, so the usual `const { trust: _x, ...rest }` omission is an error.
      const legacy = { ...entry };
      delete legacy.trust;
      return legacy;
    }),
  };
}

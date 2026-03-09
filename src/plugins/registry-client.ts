// §69 Plugin Registry Client — GitHub-based registry with 24h cache
import { usePluginStore } from "../stores/plugin-store";
import { pluginFetchRegistry } from "../ipc/plugin-invoke";
import type { RegistryIndex, RegistryEntry } from "./types";

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

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
    const index = await pluginFetchRegistry(store.registryUrl);
    store.setRegistryCache(index);
    return index;
  } catch (err) {
    // If fetch fails and we have stale cache, return it
    if (store.registryCache) {
      console.warn("[Registry] Fetch failed, using stale cache:", err);
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

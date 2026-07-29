import type { PluginTrust, RegistryEntry, RegistryIndex } from "./types";

import { pluginFetchRegistry } from "../ipc/plugin-invoke";
// §69 Plugin Registry Client — GitHub-based registry with 24h cache
import { usePluginStore } from "../stores/system/plugin";
import { logger } from "../utils/logger";
import { VALID_CAPABILITIES } from "./manifest";

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

const TRUST_VALUES: readonly PluginTrust[] = ["sandboxed", "trusted"];

/** Check for updates for all installed plugins */
export async function checkForUpdates(): Promise<Record<string, string>> {
  const store = usePluginStore.getState();
  const index = await fetchRegistryIndex();
  const updates: Record<string, string> = {};

  for (const [id, plugin] of Object.entries(store.installedPlugins)) {
    const registryEntry = index.plugins.find((p) => p.id === id);
    // §260 Phase 6 code review (L1) — skip an entry the install path will refuse. A legacy
    // entry (no tier, or one normalized away above) can only produce an error, so offering an
    // update badge and an enabled button for it promises an action that cannot succeed.
    if (!registryEntry?.trust) continue;
    if (registryEntry.version !== plugin.manifest.version) {
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
    plugins: index.plugins.map((raw) => {
      // §260 Phase 6 code review round 3 (MEDIUM-2) — `demotedBecause` is OURS, and the type
      // says so ("NOT a registry field"), but nothing enforced it. A remote entry with no
      // `trust` and only valid capabilities takes the early return below unchanged, so a
      // registry-supplied `"demotedBecause": "unknown-capability"` survived verbatim and made
      // the detail view tell the user to "Update Baram" for a plugin that genuinely predates
      // the trust model. Stripped on INGEST, before any branch can preserve it.
      const entry = { ...raw };
      delete entry.demotedBecause;

      const unknownTier =
        entry.trust !== undefined && !TRUST_VALUES.includes(entry.trust);
      // §260 Phase 6 code review (M3) — the OTHER half of the consent tuple, by the same
      // argument. `capabilities` was passed through raw, and `PluginConsentDialog` renders
      // `CAPABILITY_DESCRIPTIONS[cap] ?? cap` — so an entry claiming
      // `capabilities: ["reads nothing, fully offline"]` put unbounded registry-authored prose
      // into the one dialog whose whole job is to be trusted, and stored it verbatim as the
      // approved consent. React escapes markup so there was no injection, but the install only
      // failed AFTERWARDS, when `validateManifest` rejected the downloaded manifest — i.e.
      // after the user had approved it.
      const unknownCapabilities = entry.capabilities.filter(
        (cap) => !VALID_CAPABILITIES.includes(cap),
      );
      if (!unknownTier && unknownCapabilities.length === 0) return entry;

      logger.warn(
        `[Registry] ${entry.id} is not installable by this build — ` +
          [
            unknownTier && `unknown trust tier ${JSON.stringify(entry.trust)}`,
            unknownCapabilities.length > 0 &&
              `unknown capabilities ${unknownCapabilities
                .map((c) => JSON.stringify(c))
                .join(", ")}`,
          ]
            .filter(Boolean)
            .join("; ") +
          " — treating the entry as legacy",
      );
      // Fails closed to the SAME legacy path either way: dropping the tier is what disables
      // Install, and the marketplace already explains that state.
      //
      // Deleted rather than destructured away: this project's lint ignores `^_` for
      // arguments only, so the usual `const { trust: _x, ...rest }` omission is an error.
      const legacy = { ...entry };
      delete legacy.trust;
      // §260 Phase 6 code review round 2 (two LOWs, one cause). WHY the entry was demoted, so
      // the marketplace can say something true: the existing copy reads "predates Baram's
      // plugin trust model… ask the author to declare a trust tier", which for an
      // unknown-CAPABILITY entry tells the author to do what they already did, and points the
      // user away from the likely remedy (this build is older than the registry — update
      // Baram). Until now that distinction existed only in the `logger.warn` above.
      legacy.demotedBecause = unknownTier
        ? "unknown-tier"
        : "unknown-capability";
      // …and the unknown capability STRINGS go, because `PluginCard`/`PluginDetail` render each
      // capability as a badge label. M3's principle — registry-authored prose must not reach a
      // trusted surface — was only half applied while legacy entries stayed listed. The entry
      // cannot be installed, so a badge for a capability this build cannot name buys nothing.
      if (unknownCapabilities.length > 0) {
        legacy.capabilities = entry.capabilities.filter((cap) =>
          VALID_CAPABILITIES.includes(cap),
        );
      }
      return legacy;
    }),
  };
}

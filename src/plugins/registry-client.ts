import type { RevocationList } from "./revocation";
import type {
  PluginTrust,
  RegistryEntry,
  RegistryEntryKind,
  RegistryIndex,
} from "./types";

import {
  pluginFetchCommunityRegistry,
  pluginFetchRegistry,
} from "../ipc/plugin-invoke";
// §69 Plugin Registry Client — GitHub-based registry with 24h cache
import { usePluginStore } from "../stores/system/plugin";
import { registryPreviewPalettes } from "../themes/theme-preview-palette";
import { logger } from "../utils/logger";
import {
  applyCommunityRules,
  communityUrlFor,
  mergeChannels,
} from "./community-registry";
import { VALID_CAPABILITIES } from "./manifest";
import { isListable, revocationFor } from "./revocation";

const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/** §360 — the two kinds `normalizeIndex` recognizes; see `RegistryEntryKind` for the rest. */
const KIND_VALUES: readonly RegistryEntryKind[] = ["plugin", "theme"];

const TRUST_VALUES: readonly PluginTrust[] = ["sandboxed", "trusted"];

/**
 * Longest `readme` URL this build will carry out of an index.
 *
 * Not a security boundary — Rust's origin check is — but a URL this long is not a URL, and
 * without a bound an index could park megabytes per entry in the store, which is persisted
 * and re-read on every launch. Generous enough that no real URL meets it.
 */
const MAX_README_URL_CHARS = 2048;

/** What `community.json` contributed, and why nothing did when it failed. */
interface CommunityListing {
  error?: string;
  plugins: RegistryEntry[];
}

/**
 * Check for updates for all installed plugins.
 *
 * Returns what the store RECORDED for each plugin whose listed version differs — read back
 * from it rather than re-derived, because `setUpdateAvailable` refuses a revoked version (§69)
 * and a second copy of that rule here could drift from it.
 */
export async function checkForUpdates(): Promise<Record<string, string>> {
  const store = usePluginStore.getState();
  const index = await fetchRegistryIndex();
  const updates: Record<string, string> = {};

  for (const [id, plugin] of Object.entries(store.installedPlugins)) {
    // §361 Task 6 — the KIND is part of the match, not just the id. `dropAmbiguousIds` (in
    // `normalizeIndex`) already makes an id claimed twice resolve to neither entry, so a theme
    // cannot shadow a plugin by colliding with it; what this closes is the other shape, an
    // entry that USED to be a plugin and is now published as `kind: "theme"`. Without the
    // filter that entry raises an update badge on an installed plugin and `handleUpdate` then
    // downloads a theme archive over it, which can only fail after the user has clicked.
    // Absence still reads as `"plugin"`, the default `RegistryEntry.kind` documents.
    const registryEntry = index.plugins.find(
      (p) => p.id === id && (p.kind ?? "plugin") === "plugin",
    );
    // §260 Phase 6 code review (L1) — skip an entry the install path will refuse. A legacy
    // entry (no tier, or one normalized away above) can only produce an error, so offering an
    // update badge and an enabled button for it promises an action that cannot succeed.
    if (!registryEntry?.trust) continue;
    if (registryEntry.version !== plugin.manifest.version) {
      store.setUpdateAvailable(id, registryEntry.version);
      const recorded = usePluginStore.getState().updateAvailable;
      if (Object.hasOwn(recorded, id)) updates[id] = recorded[id];
    }
  }

  return updates;
}

/**
 * Both registry files, served as one list (§382).
 *
 * `index.json` is Baram's own channel and `community.json` the community one. Each goes
 * through its own 24-hour cache, and a failure on one side neither clears nor blocks the
 * other (spec 0058 §9.1). A first-party failure with nothing cached still throws, as it
 * always has — Browse shows its error state. A community failure never throws: the
 * first-party list is served, and `communityError` says why the rest is missing.
 *
 * `forceRefresh` (↻ Refresh) forces both.
 */
export async function fetchRegistryIndex(
  forceRefresh = false,
): Promise<RegistryIndex> {
  const [firstParty, community] = await Promise.all([
    firstPartyIndex(forceRefresh),
    communityListing(forceRefresh),
  ]);
  const merged: RegistryIndex = {
    ...firstParty,
    plugins: mergeChannels(firstParty.plugins, community.plugins),
  };
  if (community.error !== undefined) merged.communityError = community.error;
  return merged;
}

/**
 * Search registry plugins by query.
 *
 * §360 — this is the plugin marketplace's Browse tab, and only that tab: it is the sole
 * caller in the app (`checkForUpdates` and the install path key `index.plugins` directly).
 * A theme entry belongs in the theme gallery, not here, so it is filtered out before the
 * query even runs — an empty query must not surface it either. Absence still reads as
 * `"plugin"`, the same default `RegistryEntry.kind`'s doc comment describes.
 *
 * §69 — an entry is dropped at the same point, for the same reason, when the governing
 * (worst) revocation of its LISTED version is `unlisted`: spec 0041's `unlisted` blocks new
 * installs, this list is where a new install starts, and showing it would offer an Install
 * button that `usePluginActions`'s gate refuses. A version also revoked `vulnerable` or
 * `malicious` stays, since the worse entry governs. The rule is {@link isListable}'s, shared
 * with `searchThemeRegistry`. `revocations` is required so each caller says which list it
 * holds; `null` means no list is held (none received yet, or one cleared by `setRegistryUrl`
 * or found unreadable on rehydrate) and drops nothing.
 */
export function searchRegistry(
  index: RegistryIndex,
  query: string,
  revocations: null | RevocationList,
): RegistryEntry[] {
  const plugins = index.plugins.filter(
    (p) =>
      (p.kind ?? "plugin") === "plugin" &&
      isListable(p.id, p.version, revocations),
  );
  if (!query.trim()) return plugins;

  const lower = query.toLowerCase();
  return plugins.filter((p) => matchesQuery(p, lower));
}

/**
 * §361 fix round 1 (F7) — the five-field match `searchRegistry`/`searchThemeRegistry` both
 * ran, factored out after review found the two copies were byte-identical: a field added to
 * one silently stopped matching in the other. `lower` is already lower-cased by the caller,
 * once per query rather than once per field per entry.
 */
function matchesQuery(entry: RegistryEntry, lower: string): boolean {
  return (
    entry.name.toLowerCase().includes(lower) ||
    entry.description.toLowerCase().includes(lower) ||
    entry.id.toLowerCase().includes(lower) ||
    (entry.keywords?.some((k) => k.toLowerCase().includes(lower)) ?? false) ||
    entry.author.toLowerCase().includes(lower)
  );
}

/**
 * §361 — the theme browser's list (`ThemeBrowser.tsx`). Mirror of `searchRegistry`, filtering
 * the opposite way: only `kind: "theme"` rows, so an entry with no `kind` (read as
 * `"plugin"` — see `RegistryEntry.kind`'s doc comment) never appears here either. Reuses the
 * same `fetchRegistryIndex` result — themes and plugins share the merged list, though §382
 * split the fetch itself into `index.json` and `community.json` behind their own caches.
 *
 * §69 — a listing whose governing (worst) revocation is `unlisted` leaves this list too,
 * before the query runs, by the same {@link isListable} rule and for the reason
 * `searchRegistry` gives (here the refusing gate is `use-theme-actions.ts`'s
 * `refuseIfRevoked`).
 */
export function searchThemeRegistry(
  index: RegistryIndex,
  query: string,
  revocations: null | RevocationList,
): RegistryEntry[] {
  const themes = index.plugins.filter(
    (p) => p.kind === "theme" && isListable(p.id, p.version, revocations),
  );
  if (!query.trim()) return themes;

  const lower = query.toLowerCase();
  return themes.filter((p) => matchesQuery(p, lower));
}

/**
 * §361 Task 6 — the registry entry offering a newer version of each installed theme.
 *
 * Deliberately NOT routed through {@link checkForUpdates}: that function iterates
 * `usePluginStore`'s `installedPlugins`, installed themes live in the settings store's
 * `installedThemes`, and spec §10.2 says a theme update must not appear in the plugin
 * Updates tab. Keeping the two functions apart is what makes that true by construction
 * rather than by a filter someone could drop.
 *
 * Pure — the caller passes the records, so this can be exercised without either store.
 * `kind === "theme"` is required rather than defaulted, matching `searchThemeRegistry`
 * next door: an entry with no `kind` is a plugin and must never be offered as a theme
 * update, whatever its id says.
 *
 * "Newer" is `!==`, the same comparison `checkForUpdates` makes, and it is not a mistake:
 * a registry that rolls a bad version back publishes a LOWER number, and an editor that
 * only ever counts upwards would leave every user on the version being withdrawn.
 *
 * §69 — a listed version the revocation list names is skipped, whatever its severity: the
 * theme install gate (`use-theme-actions.ts`'s `refuseIfRevoked`) refuses every severity, so
 * offering it would raise a badge whose button can only be refused. It is the LISTED version
 * that is checked — a revocation of the installed one does not hide the update away from it.
 */
export function themeUpdatesFor(
  index: RegistryIndex,
  installedThemes: Record<
    string,
    { manifest: { version: string }; origin?: "file" }
  >,
  revocations: null | RevocationList,
): Record<string, RegistryEntry> {
  const updates: Record<string, RegistryEntry> = {};
  for (const [id, installed] of Object.entries(installedThemes)) {
    // §371 6a — 파일에서 설치한 테마는 레지스트리의 같은 id 항목과 다른 패키지다(스펙 0062 D9).
    // `handleUpdate` 도 이 함수로 항목을 다시 푸므로, 여기서 빼면 배지와 버튼이 함께 사라진다.
    if (installed.origin === "file") continue;
    const entry = index.plugins.find((p) => p.id === id && p.kind === "theme");
    if (entry === undefined) continue;
    if (entry.version === installed.manifest.version) continue;
    if (revocationFor(id, entry.version, revocations) !== null) continue;
    updates[id] = entry;
  }
  return updates;
}

/**
 * `community.json`, through its own cache. Never throws — see `fetchRegistryIndex`.
 *
 * A failure serves the stale cache when there is one, silently, which is the first-party
 * rule; with nothing cached it serves nothing and reports why. A failure is NOT cached, so
 * the next call tries again.
 */
async function communityListing(
  forceRefresh: boolean,
): Promise<CommunityListing> {
  const store = usePluginStore.getState();
  if (
    !forceRefresh &&
    store.communityCache &&
    Date.now() - store.communityCacheTime < CACHE_DURATION
  ) {
    return { plugins: store.communityCache };
  }
  try {
    const url = communityUrlFor(store.registryUrl);
    if (url === null) {
      throw new Error(`the registry URL is not a URL: ${store.registryUrl}`);
    }
    const fetched = await pluginFetchCommunityRegistry(url);
    // Normalized and ruled BEFORE caching, like the first-party side: a cache read cannot
    // skip the demotion that keeps G2.
    const plugins = applyCommunityRules(
      normalizeIndex(fetched.communityPlugins),
    );
    if (fetched.droppedCount) {
      logger.warn(
        `[Registry] ${fetched.droppedCount} community entry/entries could not be read and were skipped`,
      );
    }
    store.setCommunityCache(plugins);
    return { plugins };
  } catch (err) {
    logger.warn("[Registry] community list unavailable:", err);
    if (store.communityCache) return { plugins: store.communityCache };
    return { error: String(err), plugins: [] };
  }
}

/**
 * §69 security review (MEDIUM-2) — an id claimed twice resolves to NEITHER entry.
 *
 * THE ATTACK: every lookup in this codebase is `plugins.find((p) => p.id === id)`, so an
 * entry inserted ABOVE a legitimate one with the same id wins all three of them. Give it the
 * same `capabilities` and `trust` as the installed plugin and a higher `version`, and:
 * `checkForUpdates` raises an update badge on its own; `handleUpdate` resolves the attacker's
 * entry; `consentRequired` returns null because nothing about the consent tuple changed, so
 * NO dialog is shown; the working copy is uninstalled and the attacker's ZIP is installed.
 * Its checksum comes from the same index, so integrity verification passes. One click,
 * silent replacement of an installed plugin.
 *
 * ‼️ De-duplicating by KEEPING THE FIRST does not fix this — first is precisely what the
 * attacker arranged to be, and it is what `.find` already does. The only answer that does
 * not require trusting document order is to serve neither: an id that resolves ambiguously
 * cannot be resolved safely, and the legitimate plugin going missing from Browse is a far
 * smaller harm than the wrong plugin being installed over it. Already-installed copies are
 * untouched, and the operator gets the loud version from `scripts/validate-index.ts`.
 */
function dropAmbiguousIds(plugins: RegistryEntry[]): RegistryEntry[] {
  const seen = new Map<string, number>();
  for (const entry of plugins) {
    seen.set(entry.id, (seen.get(entry.id) ?? 0) + 1);
  }
  const duplicated = [...seen.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  if (duplicated.length === 0) return plugins;

  logger.warn(
    `[Registry] ${duplicated.length} id(s) claimed by more than one entry — serving none ` +
      `of them, because the resolution order is the attacker's choice: ${duplicated.join(", ")}`,
  );
  return plugins.filter((entry) => !duplicated.includes(entry.id));
}

/**
 * §360 — drop an entry whose `kind` is present but not one this build recognizes.
 *
 * The same fail-closed reasoning `VALID_CAPABILITIES` applies to an unknown capability below:
 * an unrecognized kind names a marketplace this build does not know how to install from (a
 * future kind) or no longer does (one withdrawn), so nothing about it can be enforced here —
 * do not let it reach a consent screen.
 *
 * DROPPED, not demoted to legacy the way an unknown `trust` or `capabilities` value is a few
 * lines down. Legacy means "readable as a plugin, just missing the tier a plugin needs to
 * install" — there is no equivalent readable-as-a-plugin fallback for an entry that names a
 * marketplace this build has never heard of.
 */
function dropUnknownKinds(plugins: RegistryEntry[]): RegistryEntry[] {
  const unknown = plugins.filter(
    (entry) => entry.kind !== undefined && !KIND_VALUES.includes(entry.kind),
  );
  if (unknown.length === 0) return plugins;

  logger.warn(
    `[Registry] dropping ${unknown.length} entr${unknown.length === 1 ? "y" : "ies"} with a kind this build does not recognize: ` +
      unknown.map((e) => `${e.id} (${JSON.stringify(e.kind)})`).join(", "),
  );
  return plugins.filter(
    (entry) => entry.kind === undefined || KIND_VALUES.includes(entry.kind),
  );
}

/** `index.json`, normalized and stamped first-party BEFORE caching, behind its own cache. */
async function firstPartyIndex(forceRefresh: boolean): Promise<RegistryIndex> {
  const store = usePluginStore.getState();
  if (
    !forceRefresh &&
    store.registryCache &&
    Date.now() - store.registryCacheTime < CACHE_DURATION
  ) {
    return store.registryCache;
  }
  try {
    const fetched = await pluginFetchRegistry(store.registryUrl);
    // Normalized BEFORE caching, so every later reader (install, update check, search) sees
    // one shape and the guard cannot be bypassed by reading the cache instead.
    const index: RegistryIndex = {
      ...fetched,
      plugins: normalizeIndex(fetched.plugins).map((entry): RegistryEntry => {
        // §382 — the CHANNEL is the file, and `publisher`/`publisherId`/`repoId` are a
        // COMMUNITY entry's fields (spec 0058 §9.1): stripped here rather than trusted to be
        // absent, because Rust's `RegistryEntry` lacking them today is not a guarantee this
        // function can rely on staying true.
        const stamped: RegistryEntry = { ...entry, channel: "first-party" };
        delete stamped.publisher;
        delete stamped.publisherId;
        delete stamped.repoId;
        return stamped;
      }),
    };
    // This `logger.warn` reaches a DEV CONSOLE ONLY — `src/utils/logger.ts` gates `warn` on
    // `isDev`, nothing forwards it to a file, and no UI reads `droppedCount`. In a release
    // build the Rust log (`src-tauri/src/logging`) is the only place a drop is recorded and
    // the dropped ids named. Rust discards entries it cannot deserialize so one bad entry
    // cannot empty the marketplace; a TOTAL drop is a hard error upstream and never arrives
    // here — this is strictly the survivable case.
    if (index.droppedCount) {
      logger.warn(
        `[Registry] ${index.droppedCount} entry/entries could not be read and were skipped — ` +
          "run `npx tsx scripts/validate-index.ts <index>` against the registry to see why",
      );
    }
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
function normalizeIndex(plugins: RegistryEntry[]): RegistryEntry[] {
  return dropUnknownKinds(dropAmbiguousIds(plugins)).map((raw) => {
    // §260 Phase 6 code review round 3 (MEDIUM-2) — `demotedBecause` is OURS, and the type
    // says so ("NOT a registry field"), but nothing enforced it. A remote entry with no
    // `trust` and only valid capabilities takes the early return below unchanged, so a
    // registry-supplied `"demotedBecause": "unknown-capability"` survived verbatim and made
    // the detail view tell the user to "Update Baram" for a plugin that genuinely predates
    // the trust model. Stripped on INGEST, before any branch can preserve it.
    const entry = { ...raw };
    delete entry.demotedBecause;

    // The same ingest rule one line up, applied to `readme`: a registry-authored value is
    // constrained before anything downstream can act on it. Rust refuses a URL outside the
    // registry that listed it, which is the check that matters and the only one that can
    // know which index the entry came from — this drops the shapes that would reach that
    // call as nonsense (a number, an empty string, a whole README inlined as the "URL").
    // `RegistryEntry.readme` is typed `string`, and nothing checks a type at runtime.
    if (
      entry.readme !== undefined &&
      (typeof entry.readme !== "string" ||
        entry.readme.length === 0 ||
        entry.readme.length > MAX_README_URL_CHARS)
    ) {
      delete entry.readme;
    }

    // 스펙 0063 §5.1 — `preview` 도 같은 수용 규칙: 레지스트리가 쓴 값은 아래로 흘러가기 전에
    // 계약으로 거른다. 테마 항목만 뜻이 있고, 틀리면 미리보기만 버린다(항목은 남는다).
    const preview =
      entry.kind === "theme"
        ? registryPreviewPalettes(entry.preview)
        : undefined;
    if (preview === undefined) delete entry.preview;
    else entry.preview = preview;

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
    legacy.demotedBecause = unknownTier ? "unknown-tier" : "unknown-capability";
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
  });
}

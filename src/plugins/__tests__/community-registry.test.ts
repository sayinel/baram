// §382 — the community list's ingest (spec 0058 §9.1): what is dropped, what is demoted,
// which side wins a collision, and that a failure on one file costs the other nothing.
// Every expected value is written by hand; nothing below is computed by the code under test.
import type {
  CommunityRegistryIndex,
  InstalledPlugin,
  RegistryEntry,
  RegistryIndex,
} from "../types";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createJSONStorage } from "zustand/middleware";

const fetchRegistry = vi.fn<(url: string) => Promise<RegistryIndex>>();
const fetchCommunity =
  vi.fn<(url: string) => Promise<CommunityRegistryIndex>>();
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginFetchCommunityRegistry: (url: string) => fetchCommunity(url),
  pluginFetchRegistry: (url: string) => fetchRegistry(url),
}));

import { usePluginStore } from "../../stores/system/plugin";
import { communityUrlFor } from "../community-registry";
import { checkForUpdates, fetchRegistryIndex } from "../registry-client";
import { communityEntry } from "./community-fixture";

/** A first-party `index.json` entry. */
function firstParty(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    author: "Baram",
    capabilities: ["events"],
    checksum: "a".repeat(64),
    description: "Counts words",
    downloadUrl:
      "https://sayinel.github.io/baram-plugins/plugins/baram-word-count-2.1.0.zip",
    engines: { baram: ">=0.5.0" },
    id: "baram-word-count",
    license: "Apache-2.0",
    name: "Word Count",
    trust: "sandboxed",
    version: "2.1.0",
    ...over,
  };
}

async function load(
  firstPartyPlugins: RegistryEntry[],
  communityPlugins: RegistryEntry[],
): Promise<RegistryIndex> {
  fetchRegistry.mockResolvedValue({ plugins: firstPartyPlugins });
  fetchCommunity.mockResolvedValue({ communityPlugins });
  return fetchRegistryIndex();
}

const ids = (index: RegistryIndex) => index.plugins.map((p) => p.id);

beforeEach(() => {
  fetchRegistry.mockReset();
  fetchCommunity.mockReset();
  // Both caches short-circuit a fetch, so every test starts with both cold.
  usePluginStore.setState({
    communityCache: null,
    communityCacheTime: 0,
    installedPlugins: {},
    registryCache: null,
    registryCacheTime: 0,
    updateAvailable: {},
  });
});

describe("community.json is read beside index.json (§382)", () => {
  it("resolves the community list next to the index", () => {
    expect(
      communityUrlFor("https://sayinel.github.io/baram-plugins/index.json"),
    ).toBe("https://sayinel.github.io/baram-plugins/community.json");
    expect(communityUrlFor("not a url")).toBeNull();
  });

  it("serves both files as one list, each entry stamped with the file it came from", async () => {
    const index = await load([firstParty()], [communityEntry()]);
    expect(fetchCommunity).toHaveBeenCalledWith(
      "https://sayinel.github.io/baram-plugins/community.json",
    );
    expect(index.plugins.map((p) => [p.id, p.channel])).toEqual([
      ["baram-word-count", "first-party"],
      ["hello-counter", "community"],
    ]);
    expect(index.plugins[1]).toMatchObject({
      publisher: "octocat",
      publisherId: 583231,
      repoId: 1296269,
      trust: "sandboxed",
    });
    expect(index.communityError).toBeUndefined();
  });

  it("stamps the channel itself — an entry cannot name its own", async () => {
    // Rust carries no `channel` field, so this cannot arrive over IPC today. The stamp is
    // still the app's to set, the way `demotedBecause` is stripped on ingest: a claim
    // "first-party" in community.json must not survive the day the pipe grows a field.
    const index = await load([], [communityEntry({ channel: "first-party" })]);
    expect(index.plugins[0].channel).toBe("community");
  });
});

describe("what community.json may not carry (§382)", () => {
  it("drops an id in the baram- namespace, and keeps its well-formed sibling", async () => {
    const index = await load(
      [],
      [communityEntry({ id: "baram-word-count" }), communityEntry()],
    );
    expect(ids(index)).toEqual(["hello-counter"]);
  });

  it("drops an entry whose publisher, publisherId or repoId is missing or malformed", async () => {
    const index = await load(
      [],
      [
        communityEntry({ id: "no-publisher", publisher: undefined }),
        communityEntry({ id: "hyphen-first", publisher: "-octocat" }),
        communityEntry({ id: "double-hyphen", publisher: "octo--cat" }),
        communityEntry({ id: "too-long", publisher: "a".repeat(40) }),
        communityEntry({
          id: "markup",
          publisher: "<img src=x onerror=alert(1)>",
        }),
        communityEntry({ id: "no-publisher-id", publisherId: undefined }),
        communityEntry({ id: "zero-publisher-id", publisherId: 0 }),
        communityEntry({ id: "fractional-id", publisherId: 1.5 }),
        communityEntry({ id: "string-id", publisherId: "583231" as never }),
        communityEntry({ id: "unsafe-id", publisherId: 2 ** 53 }),
        communityEntry({ id: "no-repo-id", repoId: undefined }),
        communityEntry({ id: "negative-repo-id", repoId: -1 }),
        communityEntry({ id: "trailing-hyphen", publisher: "octocat-" }),
        // The two that must survive: the longest legal login, and the plain fixture.
        communityEntry({ id: "longest-login", publisher: "a".repeat(39) }),
        communityEntry(),
      ],
    );
    expect(ids(index)).toEqual(["longest-login", "hello-counter"]);
  });

  it("drops a kind other than plugin, and reads an absent kind as plugin", async () => {
    const index = await load(
      [],
      [
        communityEntry({ id: "a-theme", kind: "theme" }),
        communityEntry({ id: "no-kind", kind: undefined }),
        communityEntry({ id: "a-plugin", kind: "plugin" }),
      ],
    );
    expect(ids(index)).toEqual(["no-kind", "a-plugin"]);
  });

  it("demotes a community entry declaring full trust, and leaves a first-party one alone", async () => {
    // G2 held by the app (spec 0058 §4): gate 7 already refuses to publish this, and this is
    // what stands if the registry pipeline is wrong. The entry stays LISTED — it is not
    // malformed — but without a tier, so Install is disabled and the reason is on record.
    const index = await load(
      [firstParty({ id: "baram-bullet-threading", trust: "trusted" })],
      [communityEntry({ id: "wants-full-trust", trust: "trusted" })],
    );
    const byId = Object.fromEntries(index.plugins.map((p) => [p.id, p]));
    expect(byId["baram-bullet-threading"].trust).toBe("trusted");
    expect(byId["baram-bullet-threading"].demotedBecause).toBeUndefined();
    expect(byId["wants-full-trust"]).not.toHaveProperty("trust");
    expect(byId["wants-full-trust"].demotedBecause).toBe("community-trusted");
    expect(byId["wants-full-trust"].channel).toBe("community");
  });

  it("still drops BOTH copies of an id claimed twice inside community.json", async () => {
    const index = await load(
      [],
      [
        communityEntry({
          downloadUrl:
            "https://sayinel.github.io/baram-plugins/plugins/impostor.zip",
          version: "9.9.9",
        }),
        communityEntry(),
      ],
    );
    expect(index.plugins).toEqual([]);
  });

  it("serves an id claimed by both files from index.json, and drops only the community copy", async () => {
    // ‼️ Not `dropAmbiguousIds`' rule. Serving neither here would let ONE community entry
    // delete a first-party plugin from every user's marketplace (spec 0058 §9.1).
    const index = await load(
      [firstParty({ id: "shared-id" })],
      [communityEntry({ id: "shared-id", version: "9.9.9" })],
    );
    expect(index.plugins).toHaveLength(1);
    expect(index.plugins[0]).toMatchObject({
      channel: "first-party",
      id: "shared-id",
      version: "2.1.0",
    });
  });

  it("strips publisher/publisherId/repoId from a first-party entry that carries them", async () => {
    // §382 — the channel is the FILE, not a claim the entry makes about itself. Rust's
    // `RegistryEntry` has no such fields today, but nothing here should depend on that
    // staying true forever.
    const index = await load(
      [
        firstParty({
          publisher: "someone",
          publisherId: 1,
          repoId: 2,
        }),
      ],
      [],
    );
    expect(index.plugins[0]).not.toHaveProperty("publisher");
    expect(index.plugins[0]).not.toHaveProperty("publisherId");
    expect(index.plugins[0]).not.toHaveProperty("repoId");
  });
});

describe("one file failing costs the other nothing (§382)", () => {
  it("keeps the first-party list when community.json fails, and says so", async () => {
    fetchRegistry.mockResolvedValue({ plugins: [firstParty()] });
    fetchCommunity.mockRejectedValue(
      new Error("community registry returned HTTP 500 Internal Server Error"),
    );
    const index = await fetchRegistryIndex();
    expect(ids(index)).toEqual(["baram-word-count"]);
    expect(index.communityError).toContain("HTTP 500");
  });

  it("does not cache a community failure — the next call tries again", async () => {
    // ‼️ Caching the failure (e.g. `setCommunityCache([])` in the catch branch) would make
    // this call hit the cache path on the SECOND fetch, never call `pluginFetchCommunityRegistry`
    // again, and keep serving `[]` — silently losing a real listing that shows up right after.
    fetchRegistry.mockResolvedValue({ plugins: [] });
    fetchCommunity.mockRejectedValueOnce(new Error("offline"));
    const first = await fetchRegistryIndex();
    expect(ids(first)).toEqual([]);
    expect(usePluginStore.getState().communityCache).toBeNull();

    fetchCommunity.mockResolvedValueOnce({
      communityPlugins: [communityEntry()],
    });
    const second = await fetchRegistryIndex();
    expect(fetchCommunity).toHaveBeenCalledTimes(2);
    expect(ids(second)).toEqual(["hello-counter"]);
  });

  it("still throws when index.json fails with nothing cached — and caches the community side anyway", async () => {
    fetchRegistry.mockRejectedValue(new Error("offline"));
    fetchCommunity.mockResolvedValue({ communityPlugins: [communityEntry()] });
    await expect(fetchRegistryIndex()).rejects.toThrow("offline");
    // `Promise.all` rejects as soon as index.json does; the community side finishes on its
    // own, so this waits for it rather than racing it.
    await vi.waitFor(() =>
      expect(
        usePluginStore.getState().communityCache?.map((p) => p.id),
      ).toEqual(["hello-counter"]),
    );
  });

  it("leaves each side's cache alone when the other side fails", async () => {
    await load([firstParty()], [communityEntry()]);

    // index.json fails on a forced refresh: its stale cache is served, community refreshes.
    fetchRegistry.mockRejectedValueOnce(new Error("offline"));
    fetchCommunity.mockResolvedValueOnce({
      communityPlugins: [communityEntry({ version: "1.3.0" })],
    });
    const afterFirstPartyFailure = await fetchRegistryIndex(true);
    expect(
      usePluginStore.getState().registryCache?.plugins.map((p) => p.version),
    ).toEqual(["2.1.0"]);
    expect(afterFirstPartyFailure.plugins.map((p) => p.version)).toEqual([
      "2.1.0",
      "1.3.0",
    ]);

    // community.json fails: its stale cache is served — silently, the first-party rule —
    // and index.json refreshes.
    fetchRegistry.mockResolvedValueOnce({
      plugins: [firstParty({ version: "2.2.0" })],
    });
    fetchCommunity.mockRejectedValueOnce(new Error("offline"));
    const afterCommunityFailure = await fetchRegistryIndex(true);
    expect(
      usePluginStore.getState().communityCache?.map((p) => p.version),
    ).toEqual(["1.3.0"]);
    expect(afterCommunityFailure.plugins.map((p) => p.version)).toEqual([
      "2.2.0",
      "1.3.0",
    ]);
    expect(afterCommunityFailure.communityError).toBeUndefined();
  });

  it("serves both from cache, and ↻ Refresh forces both", async () => {
    await load([firstParty()], [communityEntry()]);
    await fetchRegistryIndex();
    expect(fetchRegistry).toHaveBeenCalledTimes(1);
    expect(fetchCommunity).toHaveBeenCalledTimes(1);
    await fetchRegistryIndex(true);
    expect(fetchRegistry).toHaveBeenCalledTimes(2);
    expect(fetchCommunity).toHaveBeenCalledTimes(2);
  });
});

describe("updates read the merged list (§382)", () => {
  const installed = (version: string): InstalledPlugin => ({
    checksum: "b".repeat(64),
    enabled: true,
    installedAt: 0,
    installPath: "/plugins/hello-counter",
    manifest: {
      author: "Octo Cat",
      capabilities: ["events"],
      description: "Counts things",
      engines: { baram: ">=0.8.0" },
      id: "hello-counter",
      license: "MIT",
      main: "index.mjs",
      name: "Hello Counter",
      trust: "sandboxed",
      version,
    },
    updatedAt: 0,
  });

  it("offers an update listed in community.json", async () => {
    usePluginStore.setState({
      installedPlugins: { "hello-counter": installed("1.2.0") },
    });
    fetchRegistry.mockResolvedValue({ plugins: [] });
    fetchCommunity.mockResolvedValue({
      communityPlugins: [communityEntry({ version: "1.3.0" })],
    });
    expect(await checkForUpdates()).toEqual({ "hello-counter": "1.3.0" });
  });

  it("offers none from a demoted community entry, which the install path refuses", async () => {
    usePluginStore.setState({
      installedPlugins: { "hello-counter": installed("1.2.0") },
    });
    fetchRegistry.mockResolvedValue({ plugins: [] });
    fetchCommunity.mockResolvedValue({
      communityPlugins: [
        communityEntry({ trust: "trusted", version: "1.3.0" }),
      ],
    });
    expect(await checkForUpdates()).toEqual({});
  });
});

describe("neither registry cache comes back from storage (§382)", () => {
  /** A launch whose storage ALREADY HOLDS `state` — `revocation-client.test.ts`'s helper. */
  async function rehydrateWith(state: Record<string, unknown>) {
    const original = usePluginStore.persist.getOptions().storage;
    const version = usePluginStore.persist.getOptions().version ?? 0;
    const blob = JSON.stringify({ state, version });
    usePluginStore.persist.setOptions({
      storage: createJSONStorage(() => ({
        getItem: () => blob,
        removeItem: () => undefined,
        setItem: () => undefined,
      })),
    });
    try {
      await usePluginStore.persist.rehydrate();
    } finally {
      usePluginStore.persist.setOptions({ storage: original });
    }
  }

  it("does not restore a planted cache, which would skip the ingest rules", async () => {
    // G2 is enforced BEFORE caching — this planted entry calls itself first-party and
    // trusted, exactly what the community demotion exists to refuse.
    await rehydrateWith({
      communityCache: [
        communityEntry({ channel: "first-party", trust: "trusted" }),
      ],
      communityCacheTime: Date.now(),
      registryCache: { plugins: [] },
      registryCacheTime: Date.now(),
    });
    expect(usePluginStore.getState().communityCache).toBeNull();
    expect(usePluginStore.getState().registryCache).toBeNull();
    // The fetch is the load-bearing half: a restored fresh cache would be served without one.
    fetchRegistry.mockResolvedValue({ plugins: [] });
    fetchCommunity.mockResolvedValue({ communityPlugins: [] });
    await fetchRegistryIndex();
    expect(fetchCommunity).toHaveBeenCalledTimes(1);
    expect(fetchRegistry).toHaveBeenCalledTimes(1);
  });
});

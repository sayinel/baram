// §260 Phase 6 — the registry index is remote input, and `trust` decides which realm a
// plugin's code runs in. This suite pins the one seam where that input enters the app.
import type { RegistryEntry, RegistryIndex } from "../types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRegistry = vi.fn<(url: string) => Promise<RegistryIndex>>();
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginFetchRegistry: (url: string) => fetchRegistry(url),
}));

import { usePluginStore } from "../../stores/system/plugin";
import { checkForUpdates, fetchRegistryIndex } from "../registry-client";

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    author: "Baram",
    capabilities: ["events"],
    checksum: "a".repeat(64),
    description: "d",
    downloadUrl: "https://example.test/p.zip",
    engines: { baram: ">=0.4.0" },
    id: "p",
    license: "Apache-2.0",
    name: "P",
    trust: "sandboxed",
    version: "1.0.0",
    ...over,
  };
}

describe("fetchRegistryIndex normalizes the trust tier (§260 Phase 6)", () => {
  beforeEach(() => {
    fetchRegistry.mockReset();
    // The cache short-circuits the fetch, so every test starts with it cold.
    usePluginStore.setState({ registryCache: null, registryCacheTime: 0 });
  });

  const load = async (...plugins: RegistryEntry[]) => {
    fetchRegistry.mockResolvedValue({ plugins });
    return (await fetchRegistryIndex()).plugins;
  };

  it("passes both known tiers through untouched", async () => {
    const plugins = await load(
      entry({ id: "sandboxed-one", trust: "sandboxed" }),
      entry({ id: "trusted-one", trust: "trusted" }),
    );
    expect(plugins.map((p) => p.trust)).toEqual(["sandboxed", "trusted"]);
  });

  it("strips an unknown tier so the entry falls back to legacy", async () => {
    // Fails CLOSED rather than trusting a string it cannot enforce: `!entry.trust` is what
    // the marketplace reads to disable Install, so dropping the field is the refusal.
    const plugins = await load(
      entry({ id: "weird", trust: "semi-trusted" as never }),
    );
    expect(plugins[0]).not.toHaveProperty("trust");
    // …and only that field: the rest of the entry must survive, or the card renders empty.
    expect(plugins[0].id).toBe("weird");
    expect(plugins[0].capabilities).toEqual(["events"]);
  });

  it("leaves a genuinely legacy entry legacy, without inventing a default", async () => {
    const legacy = entry({ id: "old" });
    delete legacy.trust;
    const plugins = await load(legacy);
    expect(plugins[0]).not.toHaveProperty("trust");
  });

  it("normalizes BEFORE caching, so a cache read cannot bypass the guard", async () => {
    await load(entry({ id: "weird", trust: "semi-trusted" as never }));
    // Second call is served from the cache the first one wrote.
    const cached = (await fetchRegistryIndex()).plugins;
    expect(fetchRegistry).toHaveBeenCalledTimes(1);
    expect(cached[0]).not.toHaveProperty("trust");
  });

  it("strips the tier when a capability is one this build cannot enforce", async () => {
    // §260 Phase 6 code review (M3) — the other half of the consent tuple. Unbounded
    // registry-authored prose used to reach `PluginConsentDialog` (`CAPABILITY_DESCRIPTIONS[cap]
    // ?? cap`) and be stored as the approved consent; the install only failed afterwards.
    const plugins = await load(
      entry({
        capabilities: ["events", "reads nothing, fully offline" as never],
        id: "liar",
      }),
    );
    expect(plugins[0]).not.toHaveProperty("trust");
  });

  it("accepts an entry whose capabilities are all real", async () => {
    // The complement — otherwise "strip everything" would pass the test above.
    const plugins = await load(
      entry({ capabilities: ["ai", "editor:readonly", "storage"], id: "ok" }),
    );
    expect(plugins[0].trust).toBe("sandboxed");
  });

  it("keeps the index's other fields", async () => {
    fetchRegistry.mockResolvedValue({
      plugins: [entry()],
      updatedAt: "2026-07-29",
    });
    expect((await fetchRegistryIndex()).updatedAt).toBe("2026-07-29");
  });
});

describe("checkForUpdates skips entries the install path refuses (§260 Phase 6)", () => {
  const installed = (version: string) => ({
    p: {
      enabled: true,
      installPath: "/plugins/p",
      installedAt: 0,
      manifest: {
        capabilities: ["events"],
        description: "d",
        engines: { baram: ">=0.5.0" },
        id: "p",
        license: "Apache-2.0",
        main: "index.mjs",
        name: "P",
        trust: "sandboxed",
        version,
      },
    },
  });

  beforeEach(() => {
    fetchRegistry.mockReset();
    usePluginStore.setState({
      installedPlugins: installed("1.0.0") as never,
      registryCache: null,
      registryCacheTime: 0,
    });
  });

  it("offers an update from an entry that carries a tier", async () => {
    fetchRegistry.mockResolvedValue({ plugins: [entry({ version: "2.0.0" })] });
    expect(await checkForUpdates()).toEqual({ p: "2.0.0" });
  });

  it("offers nothing for a legacy entry, which could only ever error", async () => {
    // §260 Phase 6 code review (L1) — `handleUpdate` refuses a `trust`-less entry, so a badge
    // and an enabled button here promise an action that cannot succeed.
    const legacy = entry({ version: "2.0.0" });
    delete legacy.trust;
    fetchRegistry.mockResolvedValue({ plugins: [legacy] });
    expect(await checkForUpdates()).toEqual({});
  });

  it("offers nothing for an entry whose tier was normalized away", async () => {
    // The two guards compose: an unknown tier becomes legacy, and legacy is then skipped.
    fetchRegistry.mockResolvedValue({
      plugins: [entry({ trust: "semi-trusted" as never, version: "2.0.0" })],
    });
    expect(await checkForUpdates()).toEqual({});
  });
});

// §260 Phase 6 — the registry index is remote input, and `trust` decides which realm a
// plugin's code runs in. This suite pins the one seam where that input enters the app.
import type { RegistryEntry, RegistryIndex } from "../types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRegistry = vi.fn<(url: string) => Promise<RegistryIndex>>();
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginFetchRegistry: (url: string) => fetchRegistry(url),
}));

import { usePluginStore } from "../../stores/system/plugin";
import { fetchRegistryIndex } from "../registry-client";

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

  it("keeps the index's other fields", async () => {
    fetchRegistry.mockResolvedValue({
      plugins: [entry()],
      updatedAt: "2026-07-29",
    });
    expect((await fetchRegistryIndex()).updatedAt).toBe("2026-07-29");
  });
});

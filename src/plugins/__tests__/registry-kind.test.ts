// §360 — `kind` discriminates a plugin entry from a theme entry. The seam this suite pins is
// the same one `registry-client.test.ts` pins for `trust`: a value on the wire either survives
// unmangled to the frontend, or is refused because this build cannot enforce it. Unlike
// `trust`, an unrecognized `kind` is DROPPED rather than demoted to legacy — see
// `dropUnknownKinds`'s doc comment for why there is no "legacy kind" to fall back to.
import type { RegistryEntry, RegistryIndex } from "../types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchRegistry = vi.fn<(url: string) => Promise<RegistryIndex>>();
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginFetchRegistry: (url: string) => fetchRegistry(url),
}));

import { usePluginStore } from "../../stores/system/plugin";
import {
  fetchRegistryIndex,
  searchRegistry,
  searchThemeRegistry,
} from "../registry-client";

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

describe("fetchRegistryIndex passes `kind` through (§360)", () => {
  beforeEach(() => {
    fetchRegistry.mockReset();
    // The cache short-circuits the fetch, so every test starts with it cold.
    usePluginStore.setState({ registryCache: null, registryCacheTime: 0 });
  });

  const load = async (...plugins: RegistryEntry[]) => {
    fetchRegistry.mockResolvedValue({ plugins });
    return (await fetchRegistryIndex()).plugins;
  };

  // Core test 1 — an entry with no `kind` reads as "plugin". Not by acquiring the literal
  // value: exactly like `trust`, absence must stay absence on the wire (`registry.rs`'s
  // `registry_entry_carries_kind_back_out` pins the Rust half), and it is `searchRegistry`
  // below, plus every reader of `RegistryEntry.kind`, that treats that absence as "plugin".
  it("leaves an entry with no `kind` legacy, without inventing a default", async () => {
    const legacy = entry({ id: "old" });
    delete legacy.kind;
    const [plugins] = [await load(legacy)];
    expect(plugins[0]).not.toHaveProperty("kind");
  });

  // Core test 2 (frontend half — `registry.rs`'s `registry_entry_carries_kind_back_out` pins
  // the Rust deserialize → Tauri re-serialize half of the same round trip).
  it("carries a `theme` kind through without losing the value", async () => {
    const [plugins] = [await load(entry({ id: "a-theme", kind: "theme" }))];
    expect(plugins[0].kind).toBe("theme");
  });

  it("passes the `plugin` kind through untouched", async () => {
    const [plugins] = [await load(entry({ id: "a-plugin", kind: "plugin" }))];
    expect(plugins[0].kind).toBe("plugin");
  });

  // Core test 3.
  it("drops an entry naming a kind this build does not recognize", async () => {
    const plugins = await load(
      entry({ id: "future", kind: "future-thing" as never }),
      entry({ id: "known" }),
    );
    // By id, not by count — a normalizer that dropped both, or kept the unreadable one and
    // dropped the good one, would still satisfy `length === 1`.
    expect(plugins.map((p) => p.id)).toEqual(["known"]);
  });

  it("normalizes BEFORE caching, so a cache read cannot bypass the guard", async () => {
    await load(entry({ id: "future", kind: "future-thing" as never }));
    const cached = (await fetchRegistryIndex()).plugins;
    expect(fetchRegistry).toHaveBeenCalledTimes(1);
    expect(cached).toEqual([]);
  });
});

// Core test 5 — `searchRegistry` is the plugin marketplace's Browse tab's only source of
// entries (`PluginMarketplace.tsx`'s `filteredPlugins`); `checkForUpdates` and the install
// path key `index.plugins` directly and are untouched by this filter.
describe("searchRegistry lists only plugin-kind entries (§360)", () => {
  it("keeps a legacy entry (no `kind`) and one explicitly kind: 'plugin'", () => {
    const index: RegistryIndex = {
      plugins: [
        entry({ id: "legacy" }),
        entry({ id: "explicit", kind: "plugin" }),
      ],
    };
    expect(searchRegistry(index, "").map((p) => p.id)).toEqual([
      "legacy",
      "explicit",
    ]);
  });

  it("excludes a theme entry, even with an empty query", () => {
    const index: RegistryIndex = {
      plugins: [
        entry({ id: "a-plugin" }),
        entry({ id: "a-theme", kind: "theme" }),
      ],
    };
    expect(searchRegistry(index, "").map((p) => p.id)).toEqual(["a-plugin"]);
  });

  it("excludes a theme entry from a text search too, even when the query matches it", () => {
    const index: RegistryIndex = {
      plugins: [entry({ id: "a-theme", kind: "theme", name: "Matching Name" })],
    };
    expect(searchRegistry(index, "matching")).toEqual([]);
  });
});

// §361 fix round 1 (F8) — `searchThemeRegistry` had no DIRECT unit test; only
// `ThemeBrowser.test.tsx`'s render test exercised it (review confirmed that test does catch
// M-G, the equivalent of core test 5's mirror). Direct tests here pin the filter itself,
// same shape as `searchRegistry`'s own suite above, filtering the opposite way.
describe("searchThemeRegistry lists only theme-kind entries (§361)", () => {
  it("excludes a legacy entry (no `kind`) — absence reads as plugin, not theme", () => {
    const index: RegistryIndex = { plugins: [entry({ id: "legacy" })] };
    expect(searchThemeRegistry(index, "")).toEqual([]);
  });

  it("excludes an explicit kind: 'plugin' entry", () => {
    const index: RegistryIndex = {
      plugins: [entry({ id: "a-plugin", kind: "plugin" })],
    };
    expect(searchThemeRegistry(index, "")).toEqual([]);
  });

  it("keeps a kind: 'theme' entry, even with an empty query", () => {
    const index: RegistryIndex = {
      plugins: [
        entry({ id: "a-plugin" }),
        entry({ id: "a-theme", kind: "theme" }),
      ],
    };
    expect(searchThemeRegistry(index, "").map((p) => p.id)).toEqual([
      "a-theme",
    ]);
  });

  it("matches a theme entry by name/description/id/author/keywords", () => {
    const index: RegistryIndex = {
      plugins: [
        entry({
          author: "Ada",
          description: "a dark palette",
          id: "dracula",
          keywords: ["dark", "vampire"],
          kind: "theme",
          name: "Dracula",
        }),
      ],
    };
    expect(searchThemeRegistry(index, "dracula")).toHaveLength(1);
    expect(searchThemeRegistry(index, "dark palette")).toHaveLength(1);
    expect(searchThemeRegistry(index, "vampire")).toHaveLength(1);
    expect(searchThemeRegistry(index, "ada")).toHaveLength(1);
    expect(searchThemeRegistry(index, "nonexistent")).toEqual([]);
  });
});

// §382 — the wrapper's command NAME and arg KEY are a contract nothing else checks. `invoke`
// takes a string and a `Record<string, unknown>`, so a typo in either typechecks, every
// registry-client test passes (they mock this module), and the community list silently never
// loads — the argument `plugin-invoke.sandbox.test.ts` makes for `registryUrl`.
import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import { pluginFetchCommunityRegistry } from "../plugin-invoke";

describe("pluginFetchCommunityRegistry (§382)", () => {
  it("invokes plugin_fetch_community_registry with the URL under `url`", async () => {
    const index = { communityPlugins: [], droppedCount: 0 };
    invoke.mockResolvedValueOnce(index);
    await expect(
      pluginFetchCommunityRegistry(
        "https://sayinel.github.io/baram-plugins/community.json",
      ),
    ).resolves.toBe(index);
    expect(invoke).toHaveBeenCalledWith("plugin_fetch_community_registry", {
      url: "https://sayinel.github.io/baram-plugins/community.json",
    });
  });
});

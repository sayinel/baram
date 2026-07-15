import type { PluginManifest } from "../types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const pluginHttpFetch = vi.fn(async () => ({
  body: "ok",
  headers: { "content-type": "text/plain" },
  status: 200,
}));
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginHttpFetch: (...a: unknown[]) => pluginHttpFetch(...(a as [])),
}));

import { createExtensionContext } from "../extension-context";

function mf(caps: string[]): PluginManifest {
  return {
    id: "net-plugin",
    name: "Net",
    description: "",
    version: "1.0.0",
    author: "",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: ">=0.2.0" },
    capabilities: caps as PluginManifest["capabilities"],
  };
}

describe("ExtensionContext network API", () => {
  beforeEach(() => pluginHttpFetch.mockClear());

  it("denies network without the 'network' capability", () => {
    const ctx = createExtensionContext(mf(["commands"]), "/p");
    expect(() => ctx.network.fetch("https://x.dev")).toThrow(/network/i);
  });

  it("fetch delegates to pluginHttpFetch and returns the response", async () => {
    const ctx = createExtensionContext(mf(["network"]), "/p");
    const res = await ctx.network.fetch("https://x.dev", { method: "GET" });
    expect(pluginHttpFetch).toHaveBeenCalledWith("https://x.dev", {
      method: "GET",
    });
    expect(res).toMatchObject({ status: 200, body: "ok" });
  });
});

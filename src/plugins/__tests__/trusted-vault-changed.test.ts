// §393 — `vault:changed` in the TRUSTED tier, through the real context and the real publisher.
//
// What would make this fail:
// - keep the `events`-or-`settings` gate on `ctx.events` and the first case throws for a
//   `files:readonly`-only plugin;
// - drop the `watchVaultChanges` call from `createExtensionContext` and no case hears anything;
// - route the event through the shared bus and the `events`-only plugin hears it too.
import type { ExtensionContext, PluginManifest } from "../types";

import { afterEach, describe, expect, it, vi } from "vitest";

import { publishVaultChange } from "../../services/vault-changes";
import { createExtensionContext } from "../extension-context";

function makeManifest(id: string, capabilities: string[]): PluginManifest {
  return {
    author: "Test",
    capabilities: capabilities as PluginManifest["capabilities"],
    description: "fixture",
    engines: { baram: ">=0.7.0" },
    id,
    license: "MIT",
    main: "index.mjs",
    name: id,
    trust: "trusted",
    version: "1.0.0",
  };
}

describe("a trusted plugin hears vault:changed", () => {
  const live: ExtensionContext[] = [];
  function context(id: string, capabilities: string[]) {
    const ctx = createExtensionContext(makeManifest(id, capabilities), "/test");
    live.push(ctx);
    return ctx;
  }
  afterEach(() => {
    live
      .splice(0)
      .forEach((ctx) => ctx.subscriptions.forEach((d) => d.dispose()));
  });

  it('subscribes with only "files:readonly" and receives { context }', () => {
    const ctx = context("p", ["files:readonly"]);
    const heard = vi.fn();
    ctx.events.on("vault:changed", heard);
    publishVaultChange("ctx-1");
    expect(heard).toHaveBeenCalledWith({ context: "ctx-1" });
  });

  it("still guards app events behind events — the gate it shares the API with", () => {
    const ctx = context("p", ["files:readonly"]);
    expect(() => ctx.events.on("file:open", vi.fn())).toThrow(
      /"events" capability/,
    );
  });

  it("accepts the subscription without a file capability, and never fires it", () => {
    const ctx = context("q", ["events"]);
    const heard = vi.fn();
    ctx.events.on("vault:changed", heard);
    publishVaultChange("ctx-1");
    expect(heard).not.toHaveBeenCalled();
  });

  it("stops after the plugin's subscriptions are disposed", () => {
    const ctx = context("p", ["files"]);
    const heard = vi.fn();
    ctx.events.on("vault:changed", heard);
    live.splice(0).forEach((c) => c.subscriptions.forEach((d) => d.dispose()));
    publishVaultChange("ctx-1");
    expect(heard).not.toHaveBeenCalled();
  });
});

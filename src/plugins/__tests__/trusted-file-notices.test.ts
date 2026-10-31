// §395 spec 0074 D11 · §7 "알림" — `file:rename` / `file:delete` in the trusted tier, through the real
// context and the real notices. What fails this: routing the names through the shared bus (an
// `events`-only plugin would hear), no watcher in `createExtensionContext` (nothing heard), or a second
// subscription entry (`subscriptions` grows by one — P39).
import type { ExtensionContext, PluginManifest } from "../types";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExtensionContext } from "../extension-context";
import { __resetFileDecorations } from "../file-decorations/file-decoration-store";
import {
  notifyDeleted,
  notifyRenamed,
} from "../file-decorations/operation-notices";

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

const live: ExtensionContext[] = [];
function context(id: string, capabilities: string[]): ExtensionContext {
  const ctx = createExtensionContext(makeManifest(id, capabilities), "/test");
  live.push(ctx);
  return ctx;
}

afterEach(() => {
  live
    .splice(0)
    .forEach((ctx) => ctx.subscriptions.forEach((d) => d.dispose()));
  __resetFileDecorations();
});

describe("a trusted plugin hears the app's renames and deletions (§395)", () => {
  it("hears absolute paths with files:readonly, in one subscription entry", () => {
    const ctx = context("p", ["files:readonly"]);
    expect(ctx.subscriptions).toHaveLength(1);
    const renamed = vi.fn();
    const deleted = vi.fn();
    ctx.events.on("file:rename", renamed);
    ctx.events.on("file:delete", deleted);
    notifyRenamed("/v/a.md", "/v/b.md", false);
    notifyDeleted("/v/d", true);
    expect(renamed).toHaveBeenCalledWith("/v/a.md", "/v/b.md", false);
    expect(deleted).toHaveBeenCalledWith("/v/d", true);
  });

  /** D11 — accepted without a file capability, never fired; `events` is not the gate. */
  it("accepts the subscription with events alone and never fires it", () => {
    const ctx = context("q", ["events"]);
    const renamed = vi.fn();
    expect(() => ctx.events.on("file:rename", renamed)).not.toThrow();
    notifyRenamed("/v/a.md", "/v/b.md", false);
    expect(renamed).not.toHaveBeenCalled();
  });

  it("stops after the plugin's subscriptions are disposed", () => {
    const ctx = context("p", ["files"]);
    const renamed = vi.fn();
    ctx.events.on("file:rename", renamed);
    live.splice(0).forEach((c) => c.subscriptions.forEach((d) => d.dispose()));
    notifyRenamed("/v/a.md", "/v/b.md", false);
    expect(renamed).not.toHaveBeenCalled();
  });
});

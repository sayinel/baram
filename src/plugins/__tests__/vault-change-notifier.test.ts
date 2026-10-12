// §393 — WHO hears `vault:changed` and WHAT it carries. The tiers' deliveries are asserted at the
// call sites — `trusted-vault-changed.test.ts` and `plugin-loader.sandbox.test.ts`.
import { describe, expect, it, vi } from "vitest";

import { watchVaultChanges } from "../vault-change-notifier";

function fakeSource() {
  const listeners: Array<(id: string) => void> = [];
  return {
    count: () => listeners.length,
    publish: (id: string) => listeners.forEach((l) => l(id)),
    subscribe: (listener: (id: string) => void) => {
      listeners.push(listener);
      return () => void listeners.splice(listeners.indexOf(listener), 1);
    },
  };
}

describe("watchVaultChanges", () => {
  it("delivers { context } to a plugin with files:readonly, and stops on dispose", () => {
    const source = fakeSource();
    const deliver = vi.fn();
    const stop = watchVaultChanges({
      capabilities: ["files:readonly"],
      deliver,
      label: "Test",
      pluginId: "p",
      subscribe: source.subscribe,
    });
    source.publish("ctx-1");
    expect(deliver).toHaveBeenCalledWith({ context: "ctx-1" });
    stop();
    expect(source.count()).toBe(0);
  });

  it("does not subscribe a plugin without a file capability — events alone is not enough", () => {
    const source = fakeSource();
    watchVaultChanges({
      capabilities: ["events", "settings"],
      deliver: vi.fn(),
      label: "Test",
      pluginId: "p",
      subscribe: source.subscribe,
    });
    expect(source.count()).toBe(0);
  });

  it("keeps a throwing delivery from reaching the publisher", () => {
    const source = fakeSource();
    watchVaultChanges({
      capabilities: ["files"],
      deliver: () => {
        throw new Error("session closed");
      },
      label: "Test",
      pluginId: "p",
      subscribe: source.subscribe,
    });
    expect(() => source.publish("ctx-1")).not.toThrow();
  });
});

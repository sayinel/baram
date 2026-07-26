import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deliverSandboxEvent,
  replayCurrentState,
  resetSandboxEventBridge,
  setContextResolver,
  subscribeSandbox,
} from "../sandbox-event-bridge";

// §260 Phase 4a — the bridge that was missing: `deliverEvent` existed since Phase 2 and
// nothing called it, so a sandboxed plugin could not learn a path at all (3c-3 finding).
// What matters here is what happens ON THE WAY across — the capability gate and the
// absolute→relative translation — because both are the boundary, not a convenience.
describe("sandbox event bridge (§260 Phase 4a)", () => {
  afterEach(() => resetSandboxEventBridge());

  function sandbox(pluginId: string, capabilities: string[]) {
    const delivered: Array<[string, unknown[]]> = [];
    const subscriber = {
      capabilities: capabilities as never,
      pluginId,
      session: {
        deliverEvent: (event: string, args: unknown[]) =>
          void delivered.push([event, args]),
      },
    };
    return { delivered, subscriber };
  }

  /** A vault at /v with one file, and nothing else registered. */
  function vaultResolver() {
    return vi.fn((absolute: string) =>
      absolute.startsWith("/v/")
        ? { context: "ctx-1", path: absolute.slice("/v/".length) }
        : null,
    );
  }

  it("delivers a file event as {context, relative path}, never an absolute one", async () => {
    setContextResolver(vaultResolver());
    const { delivered, subscriber } = sandbox("p", ["events"]);
    subscribeSandbox(subscriber);

    deliverSandboxEvent("file:open", ["/v/notes/a.md"]);

    expect(delivered).toEqual([
      ["file:open", [{ context: "ctx-1", path: "notes/a.md" }]],
    ]);
    // The absolute path is the thing this tier must never receive: it names the user's
    // home directory, which is also their username.
    expect(JSON.stringify(delivered)).not.toContain("/v/");
  });

  it("drops a path-bearing event for a file in no registered context", () => {
    // §89 single-file mode, or a file outside every vault. Dropping is the honest
    // answer to "which vault-relative path is this?" — degrading to the absolute path
    // would defeat the translation entirely.
    setContextResolver(vaultResolver());
    const { delivered, subscriber } = sandbox("p", ["events"]);
    subscribeSandbox(subscriber);

    deliverSandboxEvent("file:open", ["/elsewhere/secret.md"]);

    expect(delivered).toEqual([]);
  });

  it("drops a path-bearing event when no resolver is installed yet", () => {
    // Fail-closed: before `initializePlugins` runs the bridge knows nothing about
    // contexts, and the safe answer is silence rather than an absolute path.
    const { delivered, subscriber } = sandbox("p", ["events"]);
    subscribeSandbox(subscriber);
    deliverSandboxEvent("file:open", ["/v/a.md"]);
    expect(delivered).toEqual([]);
  });

  it("delivers nothing to a plugin without the events capability", () => {
    setContextResolver(vaultResolver());
    const withCap = sandbox("granted", ["events"]);
    const without = sandbox("denied", ["files", "statusbar"]);
    subscribeSandbox(withCap.subscriber);
    subscribeSandbox(without.subscriber);

    deliverSandboxEvent("file:open", ["/v/a.md"]);
    deliverSandboxEvent("editor:ready", []);

    expect(withCap.delivered.map(([e]) => e)).toEqual([
      "file:open",
      "editor:ready",
    ]);
    expect(without.delivered).toEqual([]);
  });

  it("passes non-path events through untouched", () => {
    setContextResolver(vaultResolver());
    const { delivered, subscriber } = sandbox("p", ["events"]);
    subscribeSandbox(subscriber);
    deliverSandboxEvent("editor:ready", []);
    expect(delivered).toEqual([["editor:ready", []]]);
  });

  it("ignores a file event whose payload is not a path", () => {
    setContextResolver(vaultResolver());
    const { delivered, subscriber } = sandbox("p", ["events"]);
    subscribeSandbox(subscriber);
    deliverSandboxEvent("file:save", [undefined]);
    expect(delivered).toEqual([]);
  });

  it("resolves the path ONCE for all subscribers", () => {
    const resolver = vaultResolver();
    setContextResolver(resolver);
    const a = sandbox("a", ["events"]);
    const b = sandbox("b", ["events"]);
    subscribeSandbox(a.subscriber);
    subscribeSandbox(b.subscriber);
    deliverSandboxEvent("file:open", ["/v/a.md"]);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after unsubscribe, and only to the session that unsubscribed", () => {
    setContextResolver(vaultResolver());
    const a = sandbox("a", ["events"]);
    const b = sandbox("b", ["events"]);
    const offA = subscribeSandbox(a.subscriber);
    subscribeSandbox(b.subscriber);
    offA();

    deliverSandboxEvent("editor:ready", []);

    expect(a.delivered).toEqual([]);
    expect(b.delivered).toHaveLength(1);
  });

  it("a stale unsubscribe cannot remove the session that replaced it", () => {
    // Same hazard the loader's maps have: a reload registers a NEW session for the same
    // id, and the old load's disposable then runs. Without the identity check it would
    // silently cut events to the live plugin.
    setContextResolver(vaultResolver());
    const first = sandbox("p", ["events"]);
    const second = sandbox("p", ["events"]);
    const offFirst = subscribeSandbox(first.subscriber);
    subscribeSandbox(second.subscriber); // reload: replaces the entry
    offFirst();

    deliverSandboxEvent("editor:ready", []);

    expect(second.delivered).toHaveLength(1);
    expect(first.delivered).toEqual([]);
  });

  describe("replayCurrentState", () => {
    it("tells a just-activated plugin what is already open", () => {
      // Otherwise a plugin loaded at startup — with a file already restored — hears
      // nothing until the user switches tabs.
      setContextResolver(vaultResolver());
      const { delivered, subscriber } = sandbox("p", ["events"]);
      replayCurrentState(subscriber, "/v/open.md");
      expect(delivered).toEqual([
        ["file:open", [{ context: "ctx-1", path: "open.md" }]],
      ]);
    });

    it("replays nothing without the events capability, and nothing when no file is open", () => {
      setContextResolver(vaultResolver());
      const denied = sandbox("d", ["files"]);
      replayCurrentState(denied.subscriber, "/v/open.md");
      expect(denied.delivered).toEqual([]);

      const empty = sandbox("e", ["events"]);
      replayCurrentState(empty.subscriber, null);
      expect(empty.delivered).toEqual([]);
    });

    it("replays nothing for a file outside every context", () => {
      setContextResolver(vaultResolver());
      const { delivered, subscriber } = sandbox("p", ["events"]);
      replayCurrentState(subscriber, "/elsewhere/secret.md");
      expect(delivered).toEqual([]);
    });

    it("reaches only the session it was given", () => {
      setContextResolver(vaultResolver());
      const target = sandbox("target", ["events"]);
      const other = sandbox("other", ["events"]);
      subscribeSandbox(other.subscriber);
      replayCurrentState(target.subscriber, "/v/open.md");
      expect(target.delivered).toHaveLength(1);
      expect(other.delivered).toEqual([]);
    });
  });
});

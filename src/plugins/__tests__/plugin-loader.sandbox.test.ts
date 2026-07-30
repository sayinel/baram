import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// §260 3c-1 — the sandboxed load path. The gate module these tests used to mock was
// deleted in Phase 5; the sandboxed branch is now reachable unconditionally.

// register/deregister call Tauri invoke in production — stub them.
const pluginSandboxRegister = vi.fn(async (..._a: unknown[]) => {});
const pluginSandboxDeregister = vi.fn(async (..._a: unknown[]) => {});
// §260 Phase 4b — `pluginSandboxStage` joins the mock because the host EDITOR bridge
// imports it (through the request router). Added to the DOUBLE rather than made optional
// in production: the real module always exports it, and a fake that quietly lacks a member
// is how a dead call path stays green (3c-2c F1).
const pluginSandboxStage = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginSandboxDeregister: (...a: unknown[]) => pluginSandboxDeregister(...a),
  pluginSandboxRegister: (...a: unknown[]) => pluginSandboxRegister(...a),
  pluginSandboxStage: (...a: unknown[]) => pluginSandboxStage(...a),
}));

import type { PluginManifest } from "../types";

import { useEditorStore } from "../../stores/editor/editor";
import { executePluginCommand } from "../extension-context";
import { PluginLoader } from "../plugin-loader";
import { legacyInstallMessage } from "../plugin-trust";
import { usePluginUIStore } from "../plugin-ui-store";
import {
  deliverSandboxEvent,
  resetSandboxEventBridge,
  setContextResolver,
} from "../sandbox/sandbox-event-bridge";
import { SandboxHost } from "../sandbox/sandbox-host";

/** A fake SandboxHost that never creates a real webview. */
function fakeHost() {
  const invokeCommand = vi.fn(async () => "ok");
  const stop = vi.fn(async () => {});
  // §260 Phase 4a — the loader subscribes the session to app events, so the fake session
  // must carry `deliverEvent`. Added to the DOUBLE rather than making the loader
  // defensive: a real `SandboxSession` always has it, and a fake that silently lacks a
  // member is how a dead call path stays green (3c-2c F1).
  const deliverEvent = vi.fn();
  // §260 3c-2b — `start(pluginId, declared)`: no install path or entry file, since
  // the sandbox resolves its own bundle through the broker.
  const start = vi.fn(
    async (
      _id: string,
      declared: unknown,
      // §260 3c-2c/4a — the host-mediated service handler. Typed here so a test can
      // reach it: it is where the `ui` capability check and the declared-item set live.
      _hostRequestHandler?: (request: unknown) => Promise<unknown>,
    ) => ({
      contributions: declared,
      deliverEvent,
      invokeCommand,
    }),
  );
  return {
    host: { start, stop } as unknown as SandboxHost,
    deliverEvent,
    start,
    stop,
    invokeCommand,
  };
}

function sandboxedManifest(
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    id: "demo",
    name: "Demo",
    description: "test",
    version: "1.0.0",
    author: "test",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: ">=0.2.0" },
    capabilities: ["storage", "commands"],
    trust: "sandboxed",
    contributions: { commands: [{ id: "hello", title: "Say Hi" }] },
    ...overrides,
  } as PluginManifest;
}

beforeEach(() => {
  // mockReset, not mockClear: some tests install a mockImplementation (a hanging
  // deregister, a rejecting stop) that must not leak into the next test.
  pluginSandboxRegister.mockReset().mockImplementation(async () => {});
  pluginSandboxDeregister.mockReset().mockImplementation(async () => {});
  usePluginUIStore.setState({ paletteCommands: [], statusBarItems: [] });
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  resetSandboxEventBridge();
});
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("PluginLoader sandboxed path (§260 3c-1)", () => {
  it("registers capabilities, starts the sandbox, and maps commands to the palette", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    const manifest = sandboxedManifest();

    await loader.loadPlugin("/p/demo", manifest);

    // §260 3c-2b (review I2) — the install path is bound WITH the grants, so Rust
    // reads the bundle from the directory the host actually resolved. A dev folder
    // may shadow an installed copy of the same id; letting Rust re-guess would run
    // one plugin's code under the other's manifest and grants.
    expect(pluginSandboxRegister).toHaveBeenCalledWith(
      "demo",
      ["storage", "commands"],
      "/p/demo",
    );
    // …but the SANDBOX still gets no path: Rust resolves the plugin's own
    // directory from the sandbox's window label when it asks for its bundle.
    // The third argument (§260 3c-2c) is the host-mediated service handler, which
    // carries the `ai` capability check — hence a function, and hence the assertion
    // that it is one: a session started WITHOUT it silently loses `ai`.
    expect(f.start).toHaveBeenCalledWith(
      "demo",
      manifest.contributions,
      expect.any(Function),
    );
    expect(loader.isLoaded("demo")).toBe(true);

    const palette = usePluginUIStore.getState().paletteCommands;
    expect(palette).toEqual([
      { commandId: "demo.hello", pluginId: "demo", title: "Say Hi" },
    ]);

    // The palette executes through executePluginCommand → the sandbox session.
    await executePluginCommand("demo.hello");
    expect(f.invokeCommand).toHaveBeenCalledWith("hello");
  });

  it("honors palette:false — registers the handler but hides it from the palette", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin(
      "/p/demo",
      sandboxedManifest({
        contributions: {
          commands: [
            { id: "shown", title: "Shown" },
            { id: "hidden", palette: false, title: "Hidden" },
          ],
        },
      }),
    );

    // Only the visible command reaches the palette...
    expect(
      usePluginUIStore.getState().paletteCommands.map((c) => c.commandId),
    ).toEqual(["demo.shown"]);
    // ...but the hidden command is still invocable (menu/programmatic path).
    await executePluginCommand("demo.hidden");
    expect(f.invokeCommand).toHaveBeenCalledWith("hidden");
  });

  it("stops the sandbox, deregisters, and removes palette commands on unload", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin("/p/demo", sandboxedManifest());

    await loader.unloadPlugin("demo");

    expect(f.stop).toHaveBeenCalledWith("demo");
    expect(pluginSandboxDeregister).toHaveBeenCalledWith("demo");
    expect(usePluginUIStore.getState().paletteCommands).toEqual([]);
    expect(loader.isLoaded("demo")).toBe(false);
    // The command handler is gone: executing it now throws.
    await expect(executePluginCommand("demo.hello")).rejects.toThrow(
      /not found/i,
    );
  });

  // §260 3c-2a review (I2) — teardown must COMPLETE before unloadPlugin resolves,
  // and stop must precede deregister. Otherwise a reload's `loadPlugin` races the
  // outgoing deregister: it would revoke the NEW registration, the fresh sandbox's
  // `plugin_sandbox_connect` would fail closed, and activate would time out — plus
  // the old webview might still hold the `plugin-<id>` label.
  it("awaits sandbox teardown on unload, stopping before deregistering", async () => {
    const order: string[] = [];
    const f = fakeHost();
    let releaseStop: () => void = () => {};
    f.stop.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        releaseStop = resolve;
      });
      order.push("stop");
    });
    pluginSandboxDeregister.mockImplementation(async () => {
      order.push("deregister");
    });

    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin("/p/demo", sandboxedManifest());

    let unloaded = false;
    const unloading = loader.unloadPlugin("demo").then(() => {
      unloaded = true;
    });

    // stop() is still in flight: unload must NOT have resolved, and deregister
    // must not have run yet.
    await Promise.resolve();
    expect(unloaded).toBe(false);
    expect(order).toEqual([]);

    releaseStop();
    await unloading;
    expect(order).toEqual(["stop", "deregister"]);
  });

  // §260 3c-2a re-review (N2) — revocation is the security-relevant half of
  // teardown and must not depend on the other half succeeding. A rejected `stop()`
  // used to skip `deregister`, leaving Rust authorizing `plugin_call` for a plugin
  // the loader had already forgotten — worst when stop failed BECAUSE the sandbox
  // is still alive.
  it("deregisters even when stopping the sandbox fails", async () => {
    const f = fakeHost();
    f.stop.mockRejectedValue(new Error("webview refused to close"));
    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin("/p/demo", sandboxedManifest());

    await loader.unloadPlugin("demo");

    expect(pluginSandboxDeregister).toHaveBeenCalledWith("demo");
    expect(loader.isLoaded("demo")).toBe(false);
  });

  it("reload does not let a late deregister revoke the new registration", async () => {
    const calls: string[] = [];
    const f = fakeHost();
    f.stop.mockImplementation(async () => {
      calls.push("stop");
    });
    pluginSandboxDeregister.mockImplementation(async () => {
      calls.push("deregister");
    });
    pluginSandboxRegister.mockImplementation(async () => {
      calls.push("register");
    });

    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin("/p/demo", sandboxedManifest());
    await loader.reloadPlugin("/p/demo", sandboxedManifest());

    // The teardown pair must be fully ordered BEFORE the re-registration.
    expect(calls).toEqual(["register", "stop", "deregister", "register"]);
  });

  // §260 3c-2b (deferred from the 3c-2a re-review, Q2) — the outer teardown timeout
  // does not cancel the in-flight `deregister`, so it can still land AFTER the next
  // `plugin_sandbox_register` and revoke the NEW grant: the fresh sandbox's connect
  // then fails closed and activate times out, with nothing linking the symptom to
  // the log line. A load must therefore WAIT for a teardown still in flight.
  it("waits for an in-flight teardown before registering the next load", async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const f = fakeHost();
    let releaseDeregister: () => void = () => {};
    f.stop.mockImplementation(async () => {
      calls.push("stop");
    });
    pluginSandboxDeregister.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        releaseDeregister = resolve;
      });
      calls.push("deregister");
    });
    pluginSandboxRegister.mockImplementation(async () => {
      calls.push("register");
    });

    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin("/p/demo", sandboxedManifest());

    // Unload with a deregister that hangs: the loader gives up waiting (outer
    // timeout) so shutdown cannot wedge, but the teardown is still running.
    const unloading = loader.unloadPlugin("demo");
    await vi.advanceTimersByTimeAsync(6000);
    await unloading;
    expect(calls).toEqual(["register", "stop"]); // deregister has NOT landed

    // A reload must not register while that deregister is outstanding.
    const reloading = loader.loadPlugin("/p/demo", sandboxedManifest());
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toEqual(["register", "stop"]); // still waiting, no new register

    releaseDeregister();
    await reloading;
    expect(calls).toEqual(["register", "stop", "deregister", "register"]);
  });

  it("refuses a legacy (trust-less) manifest (validateManifest gate)", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    const legacy = sandboxedManifest({ trust: undefined as never });

    // validateManifest rejects a trust-less manifest before the tier branch; the
    // install UI surfaces such manifests for re-validation (§260 Phase 1).
    //
    // The MESSAGE changed for the v0.5.0 release, not the refusal this test is about: a
    // trust-less record is a v0.4.x install rather than a malformed manifest, so it now names
    // the remedy instead of the schema (`legacyInstallMessage`). What matters here is still
    // that the load is refused BEFORE any sandbox is started, asserted below.
    //
    // Compared against the function's OWN output rather than a copied regex (re-review LOW-2).
    // A literal here pins the wording from a second file — and it did: this line was rewritten
    // twice in one session purely because the copy changed, which is exactly what
    // `legacy-install-upgrade.test.ts` says it avoids. This still distinguishes THIS refusal
    // from any other, because the string is specific; it just cannot drift.
    await expect(loader.loadPlugin("/p/demo", legacy)).rejects.toThrow(
      legacyInstallMessage(legacy),
    );
    expect(f.start).not.toHaveBeenCalled();
    expect(pluginSandboxRegister).not.toHaveBeenCalled();
  });

  // §260 Phase 4a — the declarative contributions the tier could not use before.
  describe("contribution mapping (§260 Phase 4a)", () => {
    const withStatusBar = () =>
      sandboxedManifest({
        capabilities: ["statusbar", "commands", "events"],
        contributions: {
          commands: [{ id: "hello", title: "Say Hi" }],
          statusBar: [
            {
              command: "hello",
              id: "count",
              text: "0 notes",
              tooltip: "click to recount",
            },
            { id: "plain", text: "idle" },
          ],
        },
      });

    it("registers declared items BEFORE the sandbox starts", async () => {
      // §260 Phase 4a code review (M1) — four comments claimed the tier's items appear
      // "before the plugin's code runs", while registration in fact sat after
      // `start()`, which awaits `activate`: up to 15s on a cold dev start, and never at
      // all if activate fails. Asserted from inside `start` so the ORDER is the subject,
      // not just the end state.
      const f = fakeHost();
      let itemsWhenStarting: string[] = [];
      f.start.mockImplementation(async (_id, declared) => {
        itemsWhenStarting = usePluginUIStore
          .getState()
          .statusBarItems.map((i) => i.itemId);
        return {
          contributions: declared,
          deliverEvent: f.deliverEvent,
          invokeCommand: f.invokeCommand,
        };
      });
      const loader = new PluginLoader(undefined, f.host);

      await loader.loadPlugin("/p/demo", withStatusBar());

      expect(itemsWhenStarting).toEqual(["demo:sb:count", "demo:sb:plain"]);
    });

    it("removes them again when the load fails before completing", async () => {
      // The other half of registering early: a plugin that never finishes loading must
      // not leave its declaration in the chrome.
      const f = fakeHost();
      f.start.mockRejectedValue(new Error("webview creation failed"));
      const loader = new PluginLoader(undefined, f.host);

      await expect(
        loader.loadPlugin("/p/demo", withStatusBar()),
      ).rejects.toThrow(/webview creation failed/);

      expect(usePluginUIStore.getState().statusBarItems).toEqual([]);
    });

    it("marks an item pending until its command handler exists", async () => {
      // §260 Phase 4a security re-review (LOW-5) — registering items before `start()`
      // (so they show while the sandbox boots) means the handler does not exist yet.
      // An enabled button that silently does nothing for up to 15s is worse than a
      // visibly disabled one.
      const f = fakeHost();
      let pendingWhenStarting: (boolean | undefined)[] = [];
      f.start.mockImplementation(async (_id, declared) => {
        pendingWhenStarting = usePluginUIStore
          .getState()
          .statusBarItems.map((i) => i.pending);
        return {
          contributions: declared,
          deliverEvent: f.deliverEvent,
          invokeCommand: f.invokeCommand,
        };
      });
      const loader = new PluginLoader(undefined, f.host);

      await loader.loadPlugin("/p/demo", withStatusBar());

      expect(pendingWhenStarting).toEqual([true, true]);
      // …and cleared once the handlers are registered.
      expect(
        usePluginUIStore.getState().statusBarItems.map((i) => i.pending),
      ).toEqual([false, false]);
    });

    it("registers declared status-bar items from the MANIFEST", async () => {
      // No plugin code has run at this point beyond `activate`; the item exists because
      // the manifest declared it, which is what makes it the tier's first UI presence.
      const f = fakeHost();
      const loader = new PluginLoader(undefined, f.host);
      await loader.loadPlugin("/p/demo", withStatusBar());

      expect(usePluginUIStore.getState().statusBarItems).toEqual([
        {
          align: "right",
          command: "demo.hello", // namespaced to the handler registry
          itemId: "demo:sb:count",
          pending: false, // handlers are live by the time the load resolves
          pluginId: "demo",
          text: "0 notes",
          tooltip: "click to recount",
        },
        {
          align: "right",
          command: undefined, // display-only
          itemId: "demo:sb:plain",
          pending: false,
          pluginId: "demo",
          text: "idle",
          tooltip: undefined,
        },
      ]);
    });

    it("sanitises declared text, which is author-controlled", async () => {
      const f = fakeHost();
      const loader = new PluginLoader(undefined, f.host);
      await loader.loadPlugin(
        "/p/demo",
        sandboxedManifest({
          capabilities: ["statusbar"],
          contributions: {
            statusBar: [{ id: "x", text: "a\nb", tooltip: "t\u0000t" }],
          },
        }),
      );
      const [item] = usePluginUIStore.getState().statusBarItems;
      expect(item.text).toBe("a b");
      expect(item.tooltip).toBe("t t");
    });

    it("removes its status-bar items on unload", async () => {
      const f = fakeHost();
      const loader = new PluginLoader(undefined, f.host);
      await loader.loadPlugin("/p/demo", withStatusBar());
      await loader.unloadPlugin("demo");
      expect(usePluginUIStore.getState().statusBarItems).toEqual([]);
    });

    it("passes the declared item ids to the host services, so ui can address them", async () => {
      const f = fakeHost();
      const loader = new PluginLoader(undefined, f.host);
      await loader.loadPlugin("/p/demo", withStatusBar());
      // The handler is built from the manifest — a plugin cannot widen this set.
      const handler = f.start.mock.calls[0][2]!;
      await expect(
        handler({ kind: "ui_status_bar", id: "count", text: "7" }),
      ).resolves.toBeUndefined();
      await expect(
        handler({ kind: "ui_status_bar", id: "undeclared", text: "7" }),
      ).rejects.toThrow(/not declared/);
      expect(
        usePluginUIStore
          .getState()
          .statusBarItems.find((i) => i.itemId === "demo:sb:count")?.text,
      ).toBe("7");
    });

    it("replays the open file to a just-loaded plugin, as a relative path", async () => {
      // The startup case: a file is already restored, so without a replay the plugin
      // learns nothing until the user switches tabs.
      setContextResolver((absolute) =>
        absolute.startsWith("/v/")
          ? { context: "ctx-1", path: absolute.slice(3) }
          : null,
      );
      useEditorStore.setState({
        activeTabId: "t1",
        tabs: [{ filePath: "/v/notes/open.md", id: "t1" }] as never,
      });
      const f = fakeHost();
      const loader = new PluginLoader(undefined, f.host);
      await loader.loadPlugin("/p/demo", withStatusBar());

      expect(f.deliverEvent).toHaveBeenCalledWith("file:open", [
        { context: "ctx-1", path: "notes/open.md" },
      ]);
    });

    it("does not replay to a plugin without the events capability", async () => {
      setContextResolver(() => ({ context: "ctx-1", path: "open.md" }));
      useEditorStore.setState({
        activeTabId: "t1",
        tabs: [{ filePath: "/v/open.md", id: "t1" }] as never,
      });
      const f = fakeHost();
      const loader = new PluginLoader(undefined, f.host);
      await loader.loadPlugin(
        "/p/demo",
        sandboxedManifest({ capabilities: ["statusbar"] }),
      );
      expect(f.deliverEvent).not.toHaveBeenCalled();
    });

    it("stops delivering events after unload", async () => {
      setContextResolver(() => ({ context: "ctx-1", path: "open.md" }));
      const f = fakeHost();
      const loader = new PluginLoader(undefined, f.host);
      await loader.loadPlugin("/p/demo", withStatusBar());
      await loader.unloadPlugin("demo");
      f.deliverEvent.mockClear();

      deliverSandboxEvent("editor:ready", []);

      expect(f.deliverEvent).not.toHaveBeenCalled();
    });
  });

  // §260 Phase 4a security review (HIGH-2) — the worst state this loader can be in.
  describe("rollback when wiring fails after the sandbox started", () => {
    // A manifest that is VALID (so `validateManifest` lets it through) whose wiring
    // fails at the last step. `validateManifest` now rejects the malformed
    // `statusBar` entry that motivated this review finding, so reaching the rollback
    // needs a failure validation cannot see — here the session's own transport dying
    // during the post-activate state replay. That ordering is the point: by then a
    // status-bar item, a palette command and an event subscription have all landed.
    const wiredManifest = () =>
      sandboxedManifest({
        capabilities: ["statusbar", "commands", "events"],
        contributions: {
          commands: [{ id: "hello", title: "Say Hi" }],
          statusBar: [{ id: "ok", text: "fine" }],
        },
      });

    /** Arrange a failure in the last wiring step, after everything else registered. */
    function failDuringReplay(f: ReturnType<typeof fakeHost>) {
      setContextResolver(() => ({ context: "ctx-1", path: "open.md" }));
      useEditorStore.setState({
        activeTabId: "t1",
        tabs: [{ filePath: "/v/open.md", id: "t1" }] as never,
      });
      f.deliverEvent.mockImplementation(() => {
        throw new Error("transport is gone");
      });
    }

    it("stops the sandbox and REVOKES its capabilities", async () => {
      // Before the fix: the throw landed between the rollback try and
      // `this.loaded.set`, so nothing was recorded, `unloadPlugin` early-returned, and
      // the still-running sandbox kept its Rust grants for the rest of the session —
      // while the user saw a plugin that simply failed to load.
      const f = fakeHost();
      failDuringReplay(f);
      const loader = new PluginLoader(undefined, f.host);

      await expect(
        loader.loadPlugin("/p/demo", wiredManifest()),
      ).rejects.toThrow(/transport is gone/);

      expect(f.stop).toHaveBeenCalledWith("demo");
      expect(pluginSandboxDeregister).toHaveBeenCalledWith("demo");
      expect(loader.isLoaded("demo")).toBe(false);
    });

    it("leaves no status-bar item, palette command, or event subscription behind", async () => {
      const f = fakeHost();
      failDuringReplay(f);
      const loader = new PluginLoader(undefined, f.host);

      await expect(
        loader.loadPlugin("/p/demo", wiredManifest()),
      ).rejects.toThrow();

      // Everything registered before the failure must be gone: each step pushed a
      // disposable, and the rollback runs them all.
      expect(usePluginUIStore.getState().statusBarItems).toEqual([]);
      expect(usePluginUIStore.getState().paletteCommands).toEqual([]);
      f.deliverEvent.mockClear();
      deliverSandboxEvent("editor:ready", []);
      expect(f.deliverEvent).not.toHaveBeenCalled();
    });

    it("revokes even when closing the webview HANGS, and still settles", async () => {
      // §260 Phase 4a security re-review (MEDIUM) — the fix for HIGH-2 introduced this:
      // the rollback awaited `sandboxHost.stop()` with no timeout. A hang is not a
      // rejection, so the `catch` never fired and the `finally` that revokes never ran —
      // the grant stayed registered forever, `runLoad` never settled, `inFlightLoads`
      // never cleared, and `initializePlugins`'s `Promise.allSettled` never returned.
      // The rollback now runs the same BOUNDED teardown `unloadPlugin` uses.
      vi.useFakeTimers();
      const f = fakeHost();
      failDuringReplay(f);
      f.stop.mockImplementation(() => new Promise<void>(() => {})); // never settles
      const loader = new PluginLoader(undefined, f.host);

      let settled = false;
      const loading = loader
        .loadPlugin("/p/demo", wiredManifest())
        .catch(() => {})
        .finally(() => {
          settled = true;
        });

      // Nothing has revoked yet: the stop is still in flight, within its budget.
      await vi.advanceTimersByTimeAsync(500);
      expect(pluginSandboxDeregister).not.toHaveBeenCalled();
      expect(settled).toBe(false);

      // Past the stop bound, revocation runs and the load settles.
      await vi.advanceTimersByTimeAsync(1000);
      await loading;
      expect(pluginSandboxDeregister).toHaveBeenCalledWith("demo");
      expect(settled).toBe(true);
      expect(loader.isLoaded("demo")).toBe(false);
    });

    it("makes the next load wait for a rollback's revocation", async () => {
      // The bound above means the rollback can return while its `deregister` is still in
      // flight — which is the 3c-2b Q2 race (a late revoke killing the NEXT load's
      // grant). The rollback therefore has to be tracked in `pendingTeardowns` too, not
      // just awaited.
      vi.useFakeTimers();
      const calls: string[] = [];
      const f = fakeHost();
      failDuringReplay(f);
      let releaseDeregister: () => void = () => {};
      pluginSandboxRegister.mockImplementation(async () => {
        calls.push("register");
      });
      pluginSandboxDeregister.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          releaseDeregister = resolve;
        });
        calls.push("deregister");
      });
      const loader = new PluginLoader(undefined, f.host);

      const failing = loader
        .loadPlugin("/p/demo", wiredManifest())
        .catch(() => {});
      await vi.advanceTimersByTimeAsync(6000); // outlast the teardown bound
      await failing;
      expect(calls).toEqual(["register"]); // deregister has NOT landed

      f.deliverEvent.mockReset();
      const retry = loader.loadPlugin("/p/demo", sandboxedManifest());
      await vi.advanceTimersByTimeAsync(50);
      expect(calls).toEqual(["register"]); // still waiting — no second register

      releaseDeregister();
      await retry;
      expect(calls).toEqual(["register", "deregister", "register"]);
    });

    it("still revokes when stopping the sandbox also fails", async () => {
      // Revocation is the security-relevant half and must not depend on the other one
      // (3c-2a re-review N2), on the rollback path as much as on the teardown path.
      const f = fakeHost();
      failDuringReplay(f);
      f.stop.mockRejectedValue(new Error("webview refused to close"));
      const loader = new PluginLoader(undefined, f.host);

      await expect(
        loader.loadPlugin("/p/demo", wiredManifest()),
      ).rejects.toThrow();

      expect(pluginSandboxDeregister).toHaveBeenCalledWith("demo");
    });

    it("puts a FAILED revocation on the thrown error, where nothing overwrites it", async () => {
      // §260 Phase 4a code review (R1) — `setError` cannot carry this: both
      // `initializePlugins` and `PluginMarketplace` call `setError(id, String(err))`
      // right after this rejects, so anything written to the store here is overwritten.
      // A live sandbox that kept its capabilities must not be the one failure the user
      // never hears about.
      const f = fakeHost();
      failDuringReplay(f);
      pluginSandboxDeregister.mockRejectedValue(new Error("broker is gone"));
      const loader = new PluginLoader(undefined, f.host);

      let error: Error | undefined;
      try {
        await loader.loadPlugin("/p/demo", wiredManifest());
      } catch (e) {
        error = e as Error;
      }
      expect(error, "the load must reject").toBeDefined();

      // The original cause still leads — it is what the user needs first — and the
      // revocation failure rides behind it.
      expect(error!.message).toMatch(/^transport is gone/);
      expect(error!.message).toContain(
        "revoking its capabilities did not complete",
      );
      expect(error!.message).toContain("broker is gone");
      expect(error!.message).toMatch(/until the app restarts/);
    });

    it("does not mention revocation when it succeeded", async () => {
      const f = fakeHost();
      failDuringReplay(f);
      const loader = new PluginLoader(undefined, f.host);

      let error: Error | undefined;
      try {
        await loader.loadPlugin("/p/demo", wiredManifest());
      } catch (e) {
        error = e as Error;
      }
      expect(error!.message).toBe("transport is gone");
    });

    it("reports the ORIGINAL failure, not a rollback error", async () => {
      const f = fakeHost();
      failDuringReplay(f);
      f.stop.mockRejectedValue(new Error("secondary"));
      pluginSandboxDeregister.mockRejectedValue(new Error("also secondary"));
      const loader = new PluginLoader(undefined, f.host);

      // The wiring error is what the user needs to see; rollback problems are logged.
      await expect(
        loader.loadPlugin("/p/demo", wiredManifest()),
      ).rejects.toThrow(/transport is gone/);
    });

    it("a later load of the same id can still succeed", async () => {
      // The point of rolling back: the `plugin-<id>` label is free and the grant is
      // gone, so a fixed manifest loads cleanly instead of colliding.
      const f = fakeHost();
      failDuringReplay(f);
      const loader = new PluginLoader(undefined, f.host);
      await expect(
        loader.loadPlugin("/p/demo", wiredManifest()),
      ).rejects.toThrow();

      f.deliverEvent.mockReset();
      await loader.loadPlugin("/p/demo", sandboxedManifest());
      expect(loader.isLoaded("demo")).toBe(true);
    });
  });

  // §260 Phase 4a security review (MEDIUM-3) — creating chrome must need the same
  // capability as updating it.
  it("ignores declared status-bar items when the plugin lacks the statusbar capability", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin(
      "/p/demo",
      sandboxedManifest({
        capabilities: ["commands"],
        contributions: {
          commands: [{ id: "hello", title: "Say Hi" }],
          statusBar: [{ id: "sneaky", text: "free real estate" }],
        },
      }),
    );

    expect(usePluginUIStore.getState().statusBarItems).toEqual([]);
    // The rest of the plugin still loads — an ignored decoration is not a load failure.
    expect(loader.isLoaded("demo")).toBe(true);
    expect(
      usePluginUIStore.getState().paletteCommands.map((c) => c.commandId),
    ).toEqual(["demo.hello"]);
  });

  // §260 Phase 5 deleted the "sandbox webview creation is dev-only" gate this last case
  // asserted — creating one in a packaged build is now the point. What still must hold
  // is that a sandboxed manifest goes to the sandbox and nowhere else, which
  // `plugin-containment.test.ts` pins against the trust routing.
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// §260 3c-1 — the sandboxed load path. Gate module is mocked so the sandboxed
// branch is reachable and the dev release gate is toggleable per test.
const arePluginsEnabled = vi.fn(() => true);
const isSandboxRuntimeAllowed = vi.fn(() => true);
vi.mock("../plugins-enabled", () => ({
  arePluginsEnabled: () => arePluginsEnabled(),
  isSandboxRuntimeAllowed: () => isSandboxRuntimeAllowed(),
}));

// register/deregister call Tauri invoke in production — stub them.
const pluginSandboxRegister = vi.fn(async (..._a: unknown[]) => {});
const pluginSandboxDeregister = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginSandboxDeregister: (...a: unknown[]) => pluginSandboxDeregister(...a),
  pluginSandboxRegister: (...a: unknown[]) => pluginSandboxRegister(...a),
}));

import type { PluginManifest } from "../types";

import { executePluginCommand } from "../extension-context";
import { PluginLoader } from "../plugin-loader";
import { usePluginUIStore } from "../plugin-ui-store";
import { SandboxHost } from "../sandbox/sandbox-host";

/** A fake SandboxHost that never creates a real webview. */
function fakeHost() {
  const invokeCommand = vi.fn(async () => "ok");
  const stop = vi.fn(async () => {});
  const start = vi.fn(
    async (
      _id: string,
      _install: string,
      _main: string,
      declared: unknown,
    ) => ({ contributions: declared, invokeCommand }),
  );
  return {
    host: { start, stop } as unknown as SandboxHost,
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
  arePluginsEnabled.mockReturnValue(true);
  isSandboxRuntimeAllowed.mockReturnValue(true);
  pluginSandboxRegister.mockClear();
  pluginSandboxDeregister.mockClear();
  usePluginUIStore.setState({ paletteCommands: [] });
});
afterEach(() => vi.clearAllMocks());

describe("PluginLoader sandboxed path (§260 3c-1)", () => {
  it("registers capabilities, starts the sandbox, and maps commands to the palette", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    const manifest = sandboxedManifest();

    await loader.loadPlugin("/p/demo", manifest);

    expect(pluginSandboxRegister).toHaveBeenCalledWith("demo", [
      "storage",
      "commands",
    ]);
    expect(f.start).toHaveBeenCalledWith(
      "demo",
      "/p/demo",
      "index.mjs",
      manifest.contributions,
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

  it("refuses a legacy (trust-less) manifest (validateManifest gate)", async () => {
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);
    const legacy = sandboxedManifest({ trust: undefined as never });

    // validateManifest rejects a trust-less manifest before the tier branch; the
    // install UI surfaces such manifests for re-validation (§260 Phase 1).
    await expect(loader.loadPlugin("/p/demo", legacy)).rejects.toThrow(
      /trust is required/i,
    );
    expect(f.start).not.toHaveBeenCalled();
    expect(pluginSandboxRegister).not.toHaveBeenCalled();
  });

  it("refuses to create a sandbox webview when the dev release gate is off", async () => {
    isSandboxRuntimeAllowed.mockReturnValue(false);
    const f = fakeHost();
    const loader = new PluginLoader(undefined, f.host);

    await expect(
      loader.loadPlugin("/p/demo", sandboxedManifest()),
    ).rejects.toThrow(/gated off/i);
    expect(f.start).not.toHaveBeenCalled();
    expect(pluginSandboxRegister).not.toHaveBeenCalled();
  });
});

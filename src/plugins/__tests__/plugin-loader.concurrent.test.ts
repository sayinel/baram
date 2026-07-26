import { beforeEach, describe, expect, it, vi } from "vitest";

// §260 Phase 3c-3 (security review, M2) — two loads of the same plugin run
// CONCURRENTLY on every dev start: `React.StrictMode` double-invokes mount effects,
// and dev is the only environment where the sandbox runs at all. `this.loaded` is
// populated only when a load FINISHES, so it cannot dedupe them, and two racing loads
// fight over one `plugin-<id>` webview label and one Rust grant — one ends up
// revoking the other's capabilities or closing its window, leaving the loader's
// bookkeeping and the live sandbox describing different plugins.
const arePluginsEnabled = vi.fn(() => true);
const isSandboxRuntimeAllowed = vi.fn(() => true);
vi.mock("../plugins-enabled", () => ({
  arePluginsEnabled: () => arePluginsEnabled(),
  isSandboxRuntimeAllowed: () => isSandboxRuntimeAllowed(),
}));

const pluginSandboxRegister = vi.fn(async (..._a: unknown[]) => {});
const pluginSandboxDeregister = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginSandboxDeregister: (...a: unknown[]) => pluginSandboxDeregister(...a),
  pluginSandboxRegister: (...a: unknown[]) => pluginSandboxRegister(...a),
}));

import type { PluginManifest } from "../types";

import { usePluginStore } from "../../stores/system/plugin";
import { PluginLoader } from "../plugin-loader";
import { SandboxHost } from "../sandbox/sandbox-host";

/** A host whose `start` blocks until the test releases it. */
function blockingHost() {
  let release: () => void = () => {};
  const started = new Promise<void>((r) => (release = r));
  const start = vi.fn(async (_id: string, declared: unknown) => {
    await started;
    return { contributions: declared, invokeCommand: vi.fn() };
  });
  return {
    host: { start, stop: vi.fn(async () => {}) } as unknown as SandboxHost,
    release,
    start,
  };
}

function manifest(): PluginManifest {
  return {
    author: "test",
    capabilities: ["storage"],
    contributions: { commands: [] },
    description: "test",
    engines: { baram: ">=0.2.0" },
    id: "demo",
    license: "MIT",
    main: "index.mjs",
    name: "Demo",
    trust: "sandboxed",
    version: "1.0.0",
  } as PluginManifest;
}

describe("PluginLoader concurrent loads (§260 3c-3)", () => {
  beforeEach(() => {
    pluginSandboxRegister.mockClear();
    pluginSandboxDeregister.mockClear();
    usePluginStore.setState({ pluginErrors: {} });
  });

  it("joins a load already in flight instead of starting a second one", async () => {
    const { host, release, start } = blockingHost();
    const loader = new PluginLoader(undefined, host);

    const first = loader.loadPlugin("/p/demo", manifest());
    const second = loader.loadPlugin("/p/demo", manifest());
    release();
    await Promise.all([first, second]);

    // One webview, one grant. Two of either is the race.
    expect(start).toHaveBeenCalledTimes(1);
    expect(pluginSandboxRegister).toHaveBeenCalledTimes(1);
    expect(loader.isLoaded("demo")).toBe(true);
  });

  it("propagates the failure to BOTH callers, and frees the id for a retry", async () => {
    const failing = {
      start: vi.fn(async () => {
        throw new Error("activate timed out");
      }),
      stop: vi.fn(async () => {}),
    } as unknown as SandboxHost;
    const loader = new PluginLoader(undefined, failing);

    const first = loader.loadPlugin("/p/demo", manifest());
    const second = loader.loadPlugin("/p/demo", manifest());
    await expect(first).rejects.toThrow(/activate timed out/);
    await expect(second).rejects.toThrow(/activate timed out/);

    // The entry must not be left behind: a later retry has to run, not join a
    // settled promise forever.
    const { host, release, start } = blockingHost();
    const retryLoader = new PluginLoader(undefined, host);
    const retry = retryLoader.loadPlugin("/p/demo", manifest());
    release();
    await retry;
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed teardown, because that is when the grant may survive", async () => {
    // §260 3c-3 review (M3): `unloadPlugin` swallows teardown errors so `unloadAll()`
    // can keep going — but the swallowed case includes `plugin_sandbox_deregister`
    // rejecting, which leaves the Rust grant REGISTERED while the loader forgets the
    // plugin. That must not look like a clean disable.
    const { host, release } = blockingHost();
    const loader = new PluginLoader(undefined, host);
    const load = loader.loadPlugin("/p/demo", manifest());
    release();
    await load;

    pluginSandboxDeregister.mockRejectedValueOnce(new Error("ipc is gone"));
    await loader.unloadPlugin("demo");

    expect(usePluginStore.getState().pluginErrors.demo).toContain(
      "may still hold its capabilities",
    );
  });
});

// Plugin containment — regression tests.
//
// §259 pinned this as "release builds must not auto-load plugins at all", because
// plugins then ran in the app's own JS realm with no isolation and the
// ExtensionContext capability check was bypassable. §260 replaced that build-time
// containment with a real boundary — a separate webview per plugin, a Rust broker that
// authorizes every op against the Tauri-verified window label — and Phase 5 removed the
// gate.
//
// The GATE is gone; the property underneath it is not. Untrusted plugin code must never
// execute in the main realm, and the only thing standing between a manifest and that
// realm is `runLoad`'s routing on `trust`. These tests pin that routing, plus the
// refusal of a manifest that declares no tier at all.
//
// Deliberately driven through the real `PluginLoader` with an injected importer rather
// than a module mock: the importer IS the main realm here, so "was it called" is exactly
// the question worth asking.
import type { PluginManifest, PluginModule } from "../types";

import { beforeEach, describe, expect, it, vi } from "vitest";

const sandboxStart = vi.fn();
const sandboxStop = vi.fn();
const registerGrant = vi.fn();

vi.mock("../../ipc/plugin-invoke", () => ({
  pluginSandboxDeregister: () => Promise.resolve(),
  pluginSandboxRegister: (...a: unknown[]) => registerGrant(...a),
  pluginSandboxStage: () => Promise.resolve(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://${p}`,
  invoke: () => Promise.resolve(null),
}));

import { PluginLoader } from "../plugin-loader";

const BASE: PluginManifest = {
  author: "Baram",
  capabilities: [],
  description: "d",
  engines: { baram: "*" },
  id: "demo",
  license: "MIT",
  main: "index.mjs",
  name: "Demo",
  trust: "sandboxed",
  version: "1.0.0",
};

/** A loader whose "main realm" is a spy, and whose sandbox host is a stub. */
function loaderWithSpies() {
  const importer = vi.fn((): Promise<PluginModule> =>
    Promise.resolve({ activate: () => {} }),
  );
  const host = {
    start: sandboxStart,
    stop: sandboxStop,
    stopAll: vi.fn().mockResolvedValue(undefined),
  };
  return {
    importer,
    loader: new PluginLoader(
      importer,
      host as unknown as ConstructorParameters<typeof PluginLoader>[1],
    ),
  };
}

describe("plugin containment (#259 → §260 Phase 5)", () => {
  beforeEach(() => {
    sandboxStart.mockReset().mockResolvedValue({
      invokeCommand: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
    });
    sandboxStop.mockReset().mockResolvedValue(undefined);
    registerGrant.mockReset().mockResolvedValue(undefined);
  });

  it("never imports a sandboxed plugin into the main realm", async () => {
    const { importer, loader } = loaderWithSpies();
    await loader.loadPlugin("/p/demo", BASE);

    expect(importer).not.toHaveBeenCalled();
    expect(sandboxStart).toHaveBeenCalledTimes(1);
    // The grant is made against the install path, which binds what `source_read` may
    // hand the sandbox — the path itself never crosses into plugin code.
    expect(registerGrant).toHaveBeenCalledWith("demo", [], "/p/demo");
  });

  it("imports a trusted plugin into the main realm — that is what the tier means", async () => {
    const { importer, loader } = loaderWithSpies();
    await loader.loadPlugin("/p/demo", { ...BASE, trust: "trusted" });

    expect(importer).toHaveBeenCalledTimes(1);
    expect(sandboxStart).not.toHaveBeenCalled();
  });

  it("refuses a legacy manifest that declares no tier, and runs nothing", async () => {
    const { importer, loader } = loaderWithSpies();
    await expect(
      loader.loadPlugin("/p/demo", {
        ...BASE,
        trust: undefined as never,
      }),
    ).rejects.toThrow(/trust/i);

    // Neither realm: a manifest with no tier must not fall through to either path.
    expect(importer).not.toHaveBeenCalled();
    expect(sandboxStart).not.toHaveBeenCalled();
    expect(registerGrant).not.toHaveBeenCalled();
  });

  it("refuses an unknown tier rather than defaulting to the main realm", async () => {
    // Fail-closed on a value from disk that matches neither tier. Defaulting to the
    // `trusted` branch — which is what an `=== "sandboxed"` check does if the refusal
    // above ever stops covering this — would run the code with no boundary at all.
    const { importer, loader } = loaderWithSpies();
    await expect(
      loader.loadPlugin("/p/demo", {
        ...BASE,
        trust: "totally-fine" as never,
      }),
    ).rejects.toThrow();

    expect(importer).not.toHaveBeenCalled();
    expect(sandboxStart).not.toHaveBeenCalled();
  });
});

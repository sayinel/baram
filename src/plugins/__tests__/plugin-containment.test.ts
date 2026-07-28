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

import { usePluginStore } from "../../stores/system/plugin";
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
    usePluginStore.setState({ devPlugins: {}, installedPlugins: {} });
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

  it("grants Rust only what the recorded consent covers, not what the file says", async () => {
    // §260 Phase 5 code review (H3). Without the narrowing, the consent record was an
    // install-time UX artifact: the cross-check proves manifest ⊆ consent when the ZIP
    // lands, and after that `baram-plugin.json` on disk is sole authority — so editing it
    // escalated on the next start with nothing asked and nothing shown.
    usePluginStore.setState({
      installedPlugins: {
        demo: {
          checksum: "c",
          consent: { capabilities: ["editor"], trust: "sandboxed" },
          enabled: true,
          installedAt: 0,
          installPath: "/p/demo",
          manifest: BASE,
          updatedAt: 0,
        },
      },
    });
    const { loader } = loaderWithSpies();

    await loader.loadPlugin("/p/demo", {
      ...BASE,
      capabilities: ["editor", "network", "files"],
    });

    expect(registerGrant).toHaveBeenCalledWith("demo", ["editor"], "/p/demo");
  });

  it("REFUSES a tier escalation rather than narrowing it", async () => {
    // §260 Phase 5 re-review (R1). `narrowToConsent` filtered capabilities and let `trust`
    // through untouched, so `runLoad`'s routing still read the manifest's own tier — and
    // sandboxed → trusted is the escalation that escapes the Rust broker entirely, landing
    // in a realm where the narrowed capability list is not a boundary at all.
    usePluginStore.setState({
      installedPlugins: {
        demo: {
          checksum: "c",
          consent: { capabilities: ["editor"], trust: "sandboxed" },
          enabled: true,
          installedAt: 0,
          installPath: "/p/demo",
          manifest: BASE,
          updatedAt: 0,
        },
      },
    });
    const { importer, loader } = loaderWithSpies();

    await expect(
      loader.loadPlugin("/p/demo", { ...BASE, trust: "trusted" }),
    ).rejects.toThrow(/approved as "sandboxed"/);

    // Neither realm ran it, and no grant was made.
    expect(importer).not.toHaveBeenCalled();
    expect(sandboxStart).not.toHaveBeenCalled();
    expect(registerGrant).not.toHaveBeenCalled();
  });

  it("allows a plugin approved AS trusted to keep loading trusted", async () => {
    // The refusal must key on the transition, not on the tier — otherwise every trusted
    // plugin breaks on its second start.
    usePluginStore.setState({
      installedPlugins: {
        demo: {
          checksum: "c",
          consent: { capabilities: ["editor"], trust: "trusted" },
          enabled: true,
          installedAt: 0,
          installPath: "/p/demo",
          manifest: BASE,
          updatedAt: 0,
        },
      },
    });
    const { importer, loader } = loaderWithSpies();

    await loader.loadPlugin("/p/demo", {
      ...BASE,
      capabilities: ["editor"],
      trust: "trusted",
    });

    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("lets a DEV folder override an installed plugin's consent, id collision and all", async () => {
    // §260 Phase 5 re-review (R2) — `plugin-lifecycle` deliberately lets a dev copy
    // override an installed plugin of the same id, so keying the consent lookup on the id
    // alone narrowed an author's working copy to the installed version's grant and told
    // them to "reinstall to re-approve" a folder.
    usePluginStore.setState({
      devPlugins: {
        demo: {
          checksum: "",
          enabled: true,
          installedAt: 0,
          installPath: "/dev/demo",
          isDev: true,
          manifest: BASE,
          updatedAt: 0,
        },
      },
      installedPlugins: {
        demo: {
          checksum: "c",
          consent: { capabilities: ["editor"], trust: "sandboxed" },
          enabled: true,
          installedAt: 0,
          installPath: "/p/demo",
          manifest: BASE,
          updatedAt: 0,
        },
      },
    });
    const { loader } = loaderWithSpies();

    await loader.loadPlugin("/dev/demo", {
      ...BASE,
      capabilities: ["editor", "network"],
    });

    expect(registerGrant).toHaveBeenCalledWith(
      "demo",
      ["editor", "network"],
      "/dev/demo",
    );
  });

  it("passes a dev plugin's manifest through — choosing the folder is the consent", async () => {
    // No record exists for a dev folder, and narrowing to nothing there would break the
    // dev loop while protecting no user.
    usePluginStore.setState({ installedPlugins: {} });
    const { loader } = loaderWithSpies();

    await loader.loadPlugin("/dev/demo", {
      ...BASE,
      capabilities: ["editor", "network"],
    });

    expect(registerGrant).toHaveBeenCalledWith(
      "demo",
      ["editor", "network"],
      "/dev/demo",
    );
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

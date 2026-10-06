// §391 spec 0070 §5 · §10 (수명) — a plugin's entry points go up only after its activation
// succeeded, in both loader tiers, and come down on unload. The user's keys stay (D10).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));
// The same doubles `plugin-loader.sandbox.test.ts` uses — the real calls are Tauri IPC.
const pluginSandboxRegister = vi.fn(async (..._a: unknown[]) => {});
const pluginSandboxDeregister = vi.fn(async (..._a: unknown[]) => {});
const pluginSandboxStage = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../../ipc/plugin-invoke", () => ({
  pluginSandboxDeregister: (...a: unknown[]) => pluginSandboxDeregister(...a),
  pluginSandboxRegister: (...a: unknown[]) => pluginSandboxRegister(...a),
  pluginSandboxStage: (...a: unknown[]) => pluginSandboxStage(...a),
}));

import type { SandboxHost } from "../sandbox/sandbox-host";
import type { PluginManifest, PluginModule } from "../types";

import { useEditorStore } from "../../stores/editor/editor";
import { useSettingsStore } from "../../stores/settings/store";
import { usePluginStore } from "../../stores/system/plugin";
import { logger } from "../../utils/logger";
import { commandHandlers, commandOwners } from "../plugin-host-registry";
import { PluginLoader } from "../plugin-loader";
import { usePluginUIStore } from "../plugin-ui-store";
import { resetSandboxEventBridge } from "../sandbox/sandbox-event-bridge";

const manifest = (overrides: Partial<PluginManifest> = {}): PluginManifest => ({
  author: "t",
  capabilities: ["commands"],
  contributions: {
    commands: [{ id: "insert", title: "Insert citation" }],
    menu: [{ command: "insert", id: "m" }],
  },
  description: "d",
  engines: { baram: ">=0.5.0" },
  id: "cite",
  license: "MIT",
  main: "index.mjs",
  name: "Cite",
  trust: "sandboxed",
  version: "1.0.0",
  ...overrides,
});

/** A SandboxHost whose `start` the test controls. */
function fakeHost(start: (id: string, declared: unknown) => Promise<unknown>) {
  const startMock = vi.fn(start);
  return {
    host: {
      start: startMock,
      stop: vi.fn(async () => {}),
    } as unknown as SandboxHost,
    start: startMock,
  };
}

const session = (declared: unknown) => ({
  contributions: declared,
  deliverEvent: vi.fn(),
  invokeCommand: vi.fn(async () => "ok"),
});

const slice = () => usePluginUIStore.getState().contributions;

beforeEach(() => {
  pluginSandboxRegister.mockReset().mockImplementation(async () => {});
  pluginSandboxDeregister.mockReset().mockImplementation(async () => {});
  usePluginUIStore.setState({
    contributions: {},
    paletteCommands: [],
    statusBarItems: [],
  });
  usePluginStore.setState({ installedPlugins: {} });
  useSettingsStore.setState({ keybindingOverrides: {} });
  useEditorStore.setState({ activeTabId: null, tabs: [] });
  resetSandboxEventBridge();
});
afterEach(() => {
  commandHandlers.clear();
  commandOwners.clear();
  vi.restoreAllMocks();
});

describe("sandboxed (§5)", () => {
  it("is not up while the sandbox activates, nor after activation fails", async () => {
    let fail!: (e: unknown) => void;
    const f = fakeHost(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const loader = new PluginLoader(undefined, f.host);
    const load = loader.loadPlugin("/p/cite", manifest());
    await vi.waitFor(() => expect(f.start).toHaveBeenCalled());
    // Activation in flight. This is the pin against registering BEFORE activation: the rollback
    // below would sweep such an entry again, so only this moment can see the difference.
    expect(slice().cite).toBeUndefined();
    fail(new Error("activate failed"));
    await expect(load).rejects.toThrow("activate failed");
    expect(slice().cite).toBeUndefined();
  });

  it("is up once the load completes, with its handler", async () => {
    const f = fakeHost(async (_id, declared) => session(declared));
    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin("/p/cite", manifest());
    expect(slice().cite?.menu).toEqual([{ command: "insert", id: "m" }]);
    expect(commandHandlers.has("cite.insert")).toBe(true);
  });

  it("comes down on unload and goes up again on the next load; the user's key stays in settings (D10)", async () => {
    useSettingsStore.setState({
      keybindingOverrides: { "plugin:cite.insert": "Mod+Alt+K" },
    });
    const f = fakeHost(async (_id, declared) => session(declared));
    const loader = new PluginLoader(undefined, f.host);
    await loader.loadPlugin("/p/cite", manifest());
    await loader.unloadPlugin("cite");
    expect(slice().cite).toBeUndefined();
    expect(useSettingsStore.getState().keybindingOverrides).toEqual({
      "plugin:cite.insert": "Mod+Alt+K",
    });
    await loader.loadPlugin("/p/cite", manifest());
    expect(slice().cite).toBeDefined();
  });
});

describe("trusted (§5 · D12)", () => {
  const trusted = (overrides: Partial<PluginManifest> = {}) =>
    manifest({ trust: "trusted", ...overrides });
  const importing = (module: PluginModule) => vi.fn(async () => module);
  const installed = (capabilities: string[]) =>
    usePluginStore.setState({
      installedPlugins: {
        cite: {
          checksum: "c",
          consent: { capabilities, trust: "trusted" },
          enabled: true,
          installedAt: 0,
          installPath: "/p/cite",
          manifest: trusted(),
          updatedAt: 0,
        },
      } as unknown as Record<string, never>,
    });

  it("is up after activate succeeded, with the handler activate registered", async () => {
    const loader = new PluginLoader(
      importing({
        activate: (ctx) => {
          ctx.commands.register("insert", () => {});
        },
      }),
    );
    await loader.loadPlugin("/p/cite", trusted());
    expect(slice().cite).toBeDefined();
    expect(commandHandlers.has("cite.insert")).toBe(true);
  });

  it("is not up when activate throws", async () => {
    const loader = new PluginLoader(
      importing({
        activate: (ctx) => {
          ctx.commands.register("insert", () => {});
          throw new Error("boom");
        },
      }),
    );
    await expect(loader.loadPlugin("/p/cite", trusted())).rejects.toThrow(
      "boom",
    );
    // Nothing unwinds a throwing activate (`runLoad`, the backlog item of spec §5) — an entry
    // registered before it would stay up for good.
    expect(slice().cite).toBeUndefined();
  });

  it("is not up when the install withheld the commands capability (D12 — after narrowToConsent)", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    installed([]);
    const loader = new PluginLoader(importing({ activate: () => {} }));
    await loader.loadPlugin("/p/cite", trusted());
    expect(loader.isLoaded("cite")).toBe(true);
    expect(slice().cite).toBeUndefined();
    expect(
      warn.mock.calls.some(([m]) =>
        String(m).includes('"commands" capability'),
      ),
    ).toBe(true);
  });

  it("is up when the same install approved it (the positive half)", async () => {
    installed(["commands"]);
    const loader = new PluginLoader(importing({ activate: () => {} }));
    await loader.loadPlugin("/p/cite", trusted());
    expect(slice().cite).toBeDefined();
  });
});

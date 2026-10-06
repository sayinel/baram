// §391 spec 0070 §5 · D7 · D12 — the contributions slice and the helpers the three entry points
// read from it.
import type { PluginEntryContributions } from "../plugin-ui-store";
import type { PluginManifest } from "../types";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../utils/logger";
import {
  declaredCommand,
  isPluginCommandLive,
  livePluginEntrySource,
  pluginGroupsByName,
  registerEntryContributions,
} from "../plugin-entry-points";
import {
  commandHandlers,
  commandOwners,
  registerHostCommandHandler,
} from "../plugin-host-registry";
import { usePluginUIStore } from "../plugin-ui-store";
import { unregisterPluginUI } from "../trusted/ui-api";

const entry = (pluginId: string, name: string): PluginEntryContributions => ({
  commands: [{ id: "go", title: "Go" }],
  menu: [],
  name,
  pluginId,
  slash: [],
});

const manifest = (overrides: Partial<PluginManifest> = {}): PluginManifest => ({
  author: "t",
  capabilities: ["commands"],
  contributions: {
    commands: [
      { id: "insert", title: "Insert citation" },
      { id: "hidden", palette: false, title: "Hidden from the palette" },
    ],
    menu: [{ command: "insert", id: "m" }],
    slash: [{ command: "insert", id: "s" }],
  },
  description: "d",
  engines: { baram: ">=0.5.0" },
  id: "cite",
  license: "MIT",
  main: "index.mjs",
  name: "Cite",
  trust: "trusted",
  version: "1.0.0",
  ...overrides,
});

beforeEach(() => usePluginUIStore.setState({ contributions: {} }));
afterEach(() => {
  commandHandlers.clear();
  commandOwners.clear();
  vi.restoreAllMocks();
});

describe("registerEntryContributions (§5)", () => {
  it("puts up the name, every declared command (palette: false too), menu and slash", () => {
    registerEntryContributions(manifest());
    expect(usePluginUIStore.getState().contributions.cite).toEqual({
      commands: [
        { id: "insert", title: "Insert citation" },
        { id: "hidden", title: "Hidden from the palette" },
      ],
      menu: [{ command: "insert", id: "m" }],
      name: "Cite",
      pluginId: "cite",
      slash: [{ command: "insert", id: "s" }],
    });
  });

  it("D12 — skips a trusted plugin without the commands capability, with one warning", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    registerEntryContributions(manifest({ capabilities: [] }));
    expect(usePluginUIStore.getState().contributions).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"commands" capability');
  });

  it("does not ask a sandboxed plugin for it — the host wires a sandboxed plugin's declared commands", () => {
    registerEntryContributions(
      manifest({ capabilities: [], trust: "sandboxed" }),
    );
    expect(usePluginUIStore.getState().contributions.cite).toBeDefined();
  });

  it("puts nothing up for a plugin that declares no command (P3)", () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    registerEntryContributions(
      manifest({ capabilities: [], contributions: {} }),
    );
    expect(usePluginUIStore.getState().contributions).toEqual({});
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("the slice's lifetime (§5)", () => {
  it("unregisterPluginUI takes the plugin's entry down and leaves the others", () => {
    usePluginUIStore.getState().registerContributions(entry("a", "A"));
    usePluginUIStore.getState().registerContributions(entry("b", "B"));
    unregisterPluginUI("a");
    expect(Object.keys(usePluginUIStore.getState().contributions)).toEqual([
      "b",
    ]);
  });

  it("an unload of a plugin with no entry keeps the same object, so no subscriber wakes", () => {
    usePluginUIStore.getState().registerContributions(entry("a", "A"));
    const before = usePluginUIStore.getState().contributions;
    // "constructor" is a legal plugin id that every object INHERITS — an `in` check would see it.
    usePluginUIStore.getState().unregisterPlugin("constructor");
    expect(usePluginUIStore.getState().contributions).toBe(before);
    // The positive half: an unload that does hold an entry replaces the object.
    usePluginUIStore.getState().unregisterPlugin("a");
    expect(usePluginUIStore.getState().contributions).not.toBe(before);
    expect(usePluginUIStore.getState().contributions).toEqual({});
  });
});

describe("visibility (D7)", () => {
  it("a command is live exactly while its handler is registered", () => {
    expect(isPluginCommandLive("cite.insert")).toBe(false);
    const handle = registerHostCommandHandler("cite.insert", () => {}, "cite");
    expect(isPluginCommandLive("cite.insert")).toBe(true);
    handle.dispose();
    expect(isPluginCommandLive("cite.insert")).toBe(false);
  });

  it("livePluginEntrySource reads the slice at the moment it is called", () => {
    const first = livePluginEntrySource();
    usePluginUIStore.getState().registerContributions(entry("a", "A"));
    expect(first.contributions).toEqual({});
    expect(livePluginEntrySource().contributions.a).toBeDefined();
    expect(livePluginEntrySource().isLive).toBe(isPluginCommandLive);
  });

  it("declaredCommand finds a declared command and nothing else", () => {
    const e = entry("a", "A");
    expect(declaredCommand(e, "go")).toEqual({ id: "go", title: "Go" });
    expect(declaredCommand(e, "nope")).toBeUndefined();
  });
});

describe("pluginGroupsByName (D5 · D6)", () => {
  it("orders by the drawn name, not the id, and by id between equal names", () => {
    const groups = pluginGroupsByName({
      "a-one": entry("a-one", "Zed"),
      "a-y": entry("a-y", "Same"),
      "b-x": entry("b-x", "Same"),
      "z-two": entry("z-two", "Alpha"),
    });
    expect(groups.map((g) => g.entry.pluginId)).toEqual([
      "z-two",
      "a-y",
      "b-x",
      "a-one",
    ]);
  });

  it("D16 — draws the name through pluginSourceLabel: bidi and control characters gone, the id when blank", () => {
    const groups = pluginGroupsByName({
      a: entry("a", "‮evil\u0007Name"),
      b: entry("b", "   "),
    });
    expect(groups.map((g) => g.label)).toEqual(["b", "evil Name"]);
  });
});

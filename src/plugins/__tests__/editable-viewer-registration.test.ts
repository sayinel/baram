// §392 spec 0071 §4 · D5 · D6 · §10 (등록) — an editable viewer is refused at registration
// unless it can hand its text back (`getText`) and the plugin holds `files`, judged on the
// capabilities the install consented to. Each refusal sits beside the registration it refuses
// being accepted, so a gate that refuses everything fails here as surely as one that refuses
// nothing.
import type {
  Disposable,
  InstalledPlugin,
  PluginCapability,
  PluginFileViewerOptions,
  PluginManifest,
  PluginModule,
} from "../types";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginStore } from "../../stores/system/plugin";
import { PluginLoader } from "../plugin-loader";
import { usePluginUIStore } from "../plugin-ui-store";
import { createUIAPI } from "../trusted/ui-api";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

const base: PluginFileViewerOptions = {
  extensions: ["strokes"],
  id: "pad",
  onMount: () => {},
};
const getText = () => '{"version":1,"strokes":[]}';
const ui = (caps: PluginCapability[]) =>
  createUIAPI("sketch", new Set(caps), [] as Disposable[]);
const stored = () => usePluginUIStore.getState().fileViewers;

beforeEach(() => {
  usePluginUIStore.setState({ fileViewers: [] });
  usePluginStore.setState({ installedPlugins: {} });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("registering an editable viewer (§4)", () => {
  it("refuses editable without getText, naming it, and stores nothing", () => {
    expect(() =>
      ui(["viewer", "files"]).registerFileViewer({ ...base, editable: true }),
    ).toThrow(/getText/);
    expect(stored()).toEqual([]);
  });

  it("accepts editable with getText and files, and stores both", () => {
    ui(["viewer", "files"]).registerFileViewer({
      ...base,
      editable: true,
      getText,
    });
    expect(stored()).toHaveLength(1);
    expect(stored()[0].editable).toBe(true);
    expect(stored()[0].getText).toBe(getText);
  });

  it("refuses editable from a plugin without the files capability", () => {
    expect(() =>
      ui(["viewer"]).registerFileViewer({ ...base, editable: true, getText }),
    ).toThrow(/"files" capability/);
    expect(stored()).toEqual([]);
  });

  it("refuses editable from a plugin that holds only files:readonly", () => {
    expect(() =>
      ui(["viewer", "files:readonly"]).registerFileViewer({
        ...base,
        editable: true,
        getText,
      }),
    ).toThrow(/"files" capability/);
    expect(stored()).toEqual([]);
  });

  it("still asks for the viewer capability first", () => {
    expect(() =>
      ui(["files"]).registerFileViewer({ ...base, editable: true, getText }),
    ).toThrow(/"viewer" capability/);
  });

  it("stores a viewer that is not editable exactly as before — no editable, no getText key", () => {
    // `getText` handed to a viewer that is not editable is ignored, not stored: the host would
    // otherwise have a getter for a viewer it never asks.
    ui(["viewer"]).registerFileViewer({ ...base, getText });
    expect(Object.keys(stored()[0]).sort()).toEqual([
      "extensions",
      "onMount",
      "onUnmount",
      "onUpdate",
      "pluginId",
      "viewerId",
    ]);
  });

  it("treats editable: false like leaving it out", () => {
    ui(["viewer"]).registerFileViewer({ ...base, editable: false });
    expect(stored()[0].editable).toBeUndefined();
  });
});

describe("D6 — judged on the capabilities the install consented to", () => {
  const MANIFEST: PluginManifest = {
    author: "t",
    capabilities: ["viewer", "files"],
    description: "d",
    engines: { baram: ">=0.5.0" },
    id: "sketch",
    license: "MIT",
    main: "index.mjs",
    name: "Sketch",
    trust: "trusted",
    version: "1.0.0",
  };
  const editableModule: PluginModule = {
    activate: (ctx) => {
      ctx.ui.registerFileViewer({ ...base, editable: true, getText });
    },
  };
  const installedWith = (capabilities: PluginCapability[]) =>
    usePluginStore.setState({
      installedPlugins: {
        sketch: {
          checksum: "c",
          consent: { capabilities, trust: "trusted" },
          enabled: true,
          installedAt: 0,
          installPath: "/p/sketch",
          manifest: MANIFEST,
          updatedAt: 0,
        },
      } as Record<string, InstalledPlugin>,
    });

  it("fails the load when the consent left files out, although the manifest asks for it", async () => {
    installedWith(["viewer"]);
    const loader = new PluginLoader(vi.fn(async () => editableModule));
    await expect(loader.loadPlugin("/p/sketch", MANIFEST)).rejects.toThrow(
      /"files" capability/,
    );
    expect(loader.isLoaded("sketch")).toBe(false);
  });

  it("loads with an editable viewer when the consent has files (the positive half)", async () => {
    installedWith(["viewer", "files"]);
    const loader = new PluginLoader(vi.fn(async () => editableModule));
    await loader.loadPlugin("/p/sketch", MANIFEST);
    expect(stored()[0]?.editable).toBe(true);
    await loader.unloadPlugin("sketch");
  });
});

describe("the published plugin API (§392 §11)", () => {
  it("names PluginFileViewerEdit", () => {
    const dts = readFileSync(
      resolve(__dirname, "../../../examples/plugins/plugin-api.d.ts"),
      "utf8",
    );
    expect(dts).toMatch(/\bPluginFileViewerEdit\b/u);
  });
});

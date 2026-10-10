// §392 spec 0071 §7.3 · D11 · §10 (해제) — unloading a plugin takes its editing mounts' changes
// BEFORE `deactivate`, for a built-in (`teardownBuiltin`) and an installed plugin
// (`unloadPlugin`). The tab then shows source, with the text and the dirty mark kept.
import type { ViewerDouble } from "../../components/editor/__tests__/viewer-edit-fixtures";
import type {
  ExtensionContext,
  PluginFileViewerOptions,
  PluginManifest,
  PluginModule,
} from "../types";
import type { RenderResult } from "@testing-library/react";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  count,
  draw,
  fill,
  harnessProps,
  newProbe,
  optionsOf,
  seedStores,
  sketchTab,
  TAB,
  viewerDouble,
} from "../../components/editor/__tests__/viewer-edit-fixtures";
import { ViewerEditHarness } from "../../components/editor/__tests__/viewer-edit-harness";
import { useEditorStore } from "../../stores/editor/editor";
import { usePluginStore } from "../../stores/system/plugin";
import {
  activateBuiltin,
  deactivateBuiltin,
  shutdownBuiltinPlugins,
} from "../plugin-lifecycle";
import { PluginLoader } from "../plugin-loader";

// `vi.hoisted` — the `../builtin` factory runs before plain top-level consts initialise
// (`plugin-entry-builtin.test.ts` does the same).
const h = vi.hoisted(() => ({
  events: [] as string[],
  options: null as null | PluginFileViewerOptions,
}));

vi.mock("../builtin", () => ({
  BUILTIN_PLUGINS: [
    {
      manifest: {
        author: "Baram",
        capabilities: ["viewer", "files"],
        description: "fixture",
        engines: { baram: ">=0.5.0" },
        id: "fix-sketch",
        license: "Apache-2.0",
        main: "(builtin)",
        name: "Fixture Sketch",
        trust: "trusted",
        version: "1.0.0",
      },
      module: {
        activate: (ctx: ExtensionContext) => {
          if (h.options) ctx.ui.registerFileViewer(h.options);
        },
        deactivate: () => {
          h.events.push("deactivate");
        },
      },
    },
  ],
}));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
}));
// `ipc/plugin-invoke` is not mocked: a trusted load and unload call none of it (its sandbox
// calls are on the sandboxed path), and `@tauri-apps/api/core`'s `invoke` above answers the
// rest — `plugin-entry-builtin.test.ts` and `builtin-viewer-handoff.test.ts` run the same
// lifecycle without mocking it. A partial factory would throw on the first export it leaves
// out (`pluginPrepareScopes`).

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

beforeEach(async () => {
  await shutdownBuiltinPlugins();
  h.events.length = 0;
  h.options = null;
  usePluginStore.setState({ installedPlugins: {} });
});

/**
 * Seed one `.strokes` tab, let `register` put the viewer up, mount it with T0, and — when
 * `drawn` — draw T1 so a change is pending. Returns with the events cleared.
 */
async function mountedUnder(
  register: (double: ViewerDouble) => Promise<void>,
  drawn = true,
): Promise<RenderResult> {
  const double = viewerDouble(h.events);
  seedStores([sketchTab()], TAB);
  await register(double);
  const view = render(
    <ViewerEditHarness {...harnessProps(newProbe(h.events))} />,
  );
  act(() => fill(TAB, "T0"));
  if (drawn) act(() => draw(double, "T1"));
  h.events.length = 0;
  return view;
}

/** Spec §10 (해제): the take came first, and the tab kept its text and its dirty mark. */
function expectTakenBeforeDeactivate(view: RenderResult): void {
  expect(count(h.events, "getText")).toBe(1);
  expect(h.events.indexOf("getText")).toBeLessThan(
    h.events.indexOf("deactivate"),
  );
  // The viewer is gone, so the tab shows source (`resolveSurfaceKind`) — with the taken text.
  expect(view.container.querySelector("pre.code-probe")?.textContent).toBe(
    "T1",
  );
  expect(useEditorStore.getState().tabs[0].isDirty).toBe(true);
}

describe("unloading a plugin with an editing mount (§7.3 · D11)", () => {
  it("a built-in: getText before deactivate; the tab shows source with its text and its dirty mark", async () => {
    const view = await mountedUnder(async (double) => {
      h.options = optionsOf(double);
      await activateBuiltin("fix-sketch");
    });
    await act(async () => {
      await deactivateBuiltin("fix-sketch");
    });
    expectTakenBeforeDeactivate(view);
  });

  it("an installed plugin: the same, through unloadPlugin", async () => {
    // `as`, not an annotation: an annotated `= null` narrows to `null` here, and the
    // assignment inside the callback is invisible to that narrowing.
    let loader = null as null | PluginLoader;
    const view = await mountedUnder(async (double) => {
      const module: PluginModule = {
        activate: (ctx) => {
          ctx.ui.registerFileViewer(optionsOf(double));
        },
        deactivate: () => {
          h.events.push("deactivate");
        },
      };
      loader = new PluginLoader(vi.fn(async () => module));
      await loader.loadPlugin("/p/sketch", MANIFEST);
    });
    await act(async () => {
      await loader?.unloadPlugin("sketch");
    });
    expectTakenBeforeDeactivate(view);
  });

  it("with no change pending, the unload reads nothing (the take is the pending change, not the unload)", async () => {
    await mountedUnder(async (double) => {
      h.options = optionsOf(double);
      await activateBuiltin("fix-sketch");
    }, false);
    await act(async () => {
      await deactivateBuiltin("fix-sketch");
    });
    expect(count(h.events, "getText")).toBe(0);
    expect(h.events).toContain("deactivate");
  });
});

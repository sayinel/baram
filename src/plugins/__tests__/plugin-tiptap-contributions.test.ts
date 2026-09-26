// §260 스펙 0050 §4 — 로더가 매니페스트의 tiptapExtensions 를 editor-surfaces 로 배선하는지
// 검증한다. Task 3(editor-surfaces.ts)는 이미 검증됐으니, 여기서는 로더가 그 API를
// `loadPlugin`/`unloadPlugin` 에서 올바른 타이밍에 호출하는지만 본다.
import type { TiptapPluginContext } from "../editor-surfaces";
import type { PluginCapability, PluginManifest } from "../types";

import { Plugin } from "@tiptap/pm/state";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import { usePluginStore } from "../../stores/system/plugin";
import {
  __resetEditorSurfaces,
  registerEditorSurface,
} from "../editor-surfaces";
import { PluginLoader } from "../plugin-loader";
import { fakeEditor } from "./fake-editor";

function trustedManifest(over: Partial<PluginManifest>): PluginManifest {
  return {
    author: "test",
    capabilities: ["extensions"],
    description: "d",
    engines: { baram: ">=0.6.1" },
    id: "p1",
    license: "Apache-2.0",
    main: "dist/index.mjs",
    name: "Test",
    trust: "trusted",
    version: "1.0.0",
    ...over,
  };
}

/** An INSTALLED record whose recorded consent is narrower than the manifest on disk. */
function installedWithConsent(
  id: string,
  manifest: PluginManifest,
  capabilities: PluginCapability[],
): void {
  usePluginStore.setState({
    installedPlugins: {
      [id]: {
        checksum: "c",
        consent: { capabilities, trust: "trusted" },
        enabled: true,
        installedAt: 0,
        installPath: `/tmp/${id}`,
        manifest,
        updatedAt: 0,
      },
    },
  });
}

describe("plugin loader → tiptap contribution wiring", () => {
  beforeEach(() => {
    __resetEditorSurfaces();
    // These loads are `isDev` with trusted manifests: they pin DEV-BUILD semantics (§379).
    usePluginStore.setState({
      devMode: { active: true, devBuild: true, enabled: false },
      installedPlugins: {},
      pluginErrors: {},
    });
  });

  test("a loaded plugin's ProseMirror plugin reaches a registered editor", async () => {
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    const loader = new PluginLoader(async () => ({
      BulletThreading: (ctx: TiptapPluginContext) =>
        new Plugin({ key: ctx.key }),
      activate() {},
    }));

    await loader.loadPlugin(
      "/tmp/p1",
      trustedManifest({
        id: "p1",
        tiptapExtensions: [
          {
            exportName: "BulletThreading",
            name: "bulletThreading",
            type: "plugin",
          },
        ],
      }),
      { isDev: true },
    );

    expect(editor.plugins).toHaveLength(1);
  });

  test("unloading removes its contribution and leaves other plugins alone", async () => {
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    // Which plugin survives, not how many: a count alone passes just as happily when
    // the WRONG one was removed, which is the failure this test exists to catch.
    const keyOf = new Map<string, unknown>();
    const obedient = (ctx: TiptapPluginContext) => {
      keyOf.set(ctx.pluginId, ctx.key);
      return new Plugin({ key: ctx.key });
    };
    const loader = new PluginLoader(async () => ({
      P: obedient,
      activate() {},
    }));
    const def = [{ exportName: "P", name: "a", type: "plugin" as const }];
    await loader.loadPlugin(
      "/tmp/p1",
      trustedManifest({ id: "p1", tiptapExtensions: def }),
      { isDev: true },
    );
    await loader.loadPlugin(
      "/tmp/p2",
      trustedManifest({
        id: "p2",
        tiptapExtensions: [{ exportName: "P", name: "b", type: "plugin" }],
      }),
      { isDev: true },
    );

    await loader.unloadPlugin("p1");

    expect(editor.keys()).toEqual([keyOf.get("p2")]);
  });

  test("a missing exportName fails the load instead of being skipped", async () => {
    const loader = new PluginLoader(async () => ({ activate() {} }));

    await expect(
      loader.loadPlugin(
        "/tmp/p1",
        trustedManifest({
          id: "p1",
          tiptapExtensions: [
            { exportName: "Missing", name: "x", type: "plugin" },
          ],
        }),
        { isDev: true },
      ),
    ).rejects.toThrow(/Missing/);
  });

  test("a contribution is not installed when activate throws", async () => {
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    const loader = new PluginLoader(async () => ({
      X: (ctx: TiptapPluginContext) => new Plugin({ key: ctx.key }),
      activate() {
        throw new Error("boom");
      },
    }));

    await expect(
      loader.loadPlugin(
        "/tmp/p1",
        trustedManifest({
          id: "p1",
          tiptapExtensions: [{ exportName: "X", name: "x", type: "plugin" }],
        }),
        { isDev: true },
      ),
    ).rejects.toThrow();
    expect(editor.plugins).toHaveLength(0);
  });

  test("installs nothing when the GRANTED capabilities lack extensions", async () => {
    // `validateManifest` refuses a manifest that declares `tiptapExtensions` without the
    // capability, but that is not the reachable case: a plugin installed under a narrower
    // consent whose later version adds both passes validation and is then narrowed by
    // `narrowToConsent` — which logs "withholding extensions" while the contributions
    // installed anyway. Gated like the sibling `statusBar` gate: warn and skip, because a
    // withheld capability means its API is denied and the plugin still runs. Failing the
    // whole load would give `extensions` harsher semantics than any other capability.
    const manifest = trustedManifest({
      id: "p1",
      tiptapExtensions: [{ exportName: "P", name: "a", type: "plugin" }],
    });
    installedWithConsent("p1", manifest, ["commands"]);
    const editor = fakeEditor();
    registerEditorSurface(editor as never);
    const loader = new PluginLoader(async () => ({
      P: (ctx: TiptapPluginContext) => new Plugin({ key: ctx.key }),
      activate() {},
    }));

    await expect(
      loader.loadPlugin("/tmp/p1", manifest),
    ).resolves.toBeUndefined();

    expect(editor.plugins).toHaveLength(0);
  });

  test("a load that fails after activate unwinds what activate registered", async () => {
    // `collectFactories` throws AFTER `activate()` succeeded and BEFORE the plugin enters
    // `loaded` — and `unloadPlugin` returns early for a plugin it never recorded, so the
    // teardown is a no-op. Without an unwind here the plugin's commands, status-bar items
    // and `context.subscriptions` stay registered with nothing able to remove them, and a
    // dev Reload runs `activate` on top of that again, each attempt. A typo in
    // `exportName` is the ordinary way in.
    const disposed = vi.fn();
    const loader = new PluginLoader(async () => ({
      activate(context: { subscriptions: { dispose: () => void }[] }) {
        context.subscriptions.push({ dispose: disposed });
      },
    }));
    const manifest = trustedManifest({
      id: "p1",
      tiptapExtensions: [{ exportName: "Typo", name: "a", type: "plugin" }],
    });

    await expect(
      loader.loadPlugin("/tmp/p1", manifest, { isDev: true }),
    ).rejects.toThrow(/Typo/);
    expect(disposed).toHaveBeenCalledTimes(1);

    // A dev Reload retries the same broken load; each attempt must clean up after itself
    // rather than pile a second activation on the first one's leftovers.
    await expect(
      loader.loadPlugin("/tmp/p1", manifest, { isDev: true }),
    ).rejects.toThrow(/Typo/);
    expect(disposed).toHaveBeenCalledTimes(2);
  });
});

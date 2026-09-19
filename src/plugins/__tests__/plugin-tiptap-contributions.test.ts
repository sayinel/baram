// §260 스펙 0050 §4 — 로더가 매니페스트의 tiptapExtensions 를 editor-surfaces 로 배선하는지
// 검증한다. Task 3(editor-surfaces.ts)는 이미 검증됐으니, 여기서는 로더가 그 API를
// `loadPlugin`/`unloadPlugin` 에서 올바른 타이밍에 호출하는지만 본다.
import type { TiptapPluginContext } from "../editor-surfaces";
import type { PluginManifest } from "../types";

import { Plugin } from "@tiptap/pm/state";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

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

describe("plugin loader → tiptap contribution wiring", () => {
  beforeEach(() => __resetEditorSurfaces());

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
    const obedient = (ctx: TiptapPluginContext) => new Plugin({ key: ctx.key });
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

    expect(editor.plugins).toHaveLength(1);
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
});

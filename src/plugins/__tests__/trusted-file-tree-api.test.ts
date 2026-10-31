// §395 spec 0074 §4 · §5.3 · §6 · D15 · plan 0127 P24 · P25 — the trusted tier's file tree methods,
// through the real `createExtensionContext`.
import type { ExtensionContext, PluginManifest } from "../types";

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createExtensionContext } from "../extension-context";
import { __resetDecorationHost } from "../file-decorations/decoration-host";
import { useFileDecorationStore } from "../file-decorations/file-decoration-store";
import { iconClassOf } from "../file-decorations/icons";
import {
  fileTreeCapabilityMessage,
  PATH_NOT_ABSOLUTE_MESSAGE,
} from "../file-decorations/validate";
import { unregisterPluginUI } from "../trusted/ui-api";

function makeManifest(id: string, capabilities: string[]): PluginManifest {
  return {
    author: "Test",
    capabilities: capabilities as PluginManifest["capabilities"],
    description: "fixture",
    engines: { baram: ">=0.7.0" },
    id,
    license: "MIT",
    main: "index.mjs",
    name: id,
    trust: "trusted",
    version: "1.0.0",
  };
}

const live: ExtensionContext[] = [];
function context(id: string, capabilities: string[]): ExtensionContext {
  const ctx = createExtensionContext(makeManifest(id, capabilities), "/test");
  live.push(ctx);
  return ctx;
}

/** Files under `src` (outside `__tests__`, not `*.test.*`) that call `unregisterPluginUI(`, with counts — the definition's file left out. */
function unregisterCallSites(): Record<string, number> {
  const root = resolve(__dirname, "../..");
  const found: Record<string, number> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "__tests__") walk(full);
        continue;
      }
      if (!/\.tsx?$/u.test(name) || name.includes(".test.")) continue;
      const count =
        readFileSync(full, "utf8").split("unregisterPluginUI(").length - 1;
      const key = relative(root, full).split(sep).join("/");
      if (count > 0 && key !== "plugins/trusted/ui-api.ts") found[key] = count;
    }
  };
  walk(root);
  return found;
}

afterEach(() => {
  live
    .splice(0)
    .forEach((ctx) => ctx.subscriptions.forEach((d) => d.dispose()));
  __resetDecorationHost();
});

describe("ctx.ui file tree methods — trusted (§395)", () => {
  /** P25 — `filetree` alone opens `ctx.ui`. What fails this: the old rule (`UI_CAPABILITIES` only) hands
   *  a filetree-only plugin the denied proxy, which throws on the property read. */
  it("decorates with filetree alone, under the plugin's name", async () => {
    const ctx = context("tb", ["filetree"]);
    await ctx.ui.setFileDecorations([
      { decoration: { badge: "1" }, path: "/v/a.md" },
    ]);
    expect(useFileDecorationStore.getState().merged.get("/v/a.md")?.title).toBe(
      "tb: 1",
    );
  });

  /** P25 — `filetree` opens the object, not the UI surface. The pair: a statusbar plugin's toast works. */
  it("keeps showNotification and addStyle behind a UI capability", () => {
    expect(() => context("t1", ["filetree"]).ui.showNotification("x")).toThrow(
      /requires one of "settings", "sidebar", "statusbar", "viewer"/,
    );
    expect(() => context("t2", ["filetree"]).ui.addStyle("p{}")).toThrow(
      /requires one of/,
    );
    expect(() =>
      context("s1", ["statusbar"]).ui.showNotification("x"),
    ).not.toThrow();
  });

  /** §6 · P24 — refused when called, with the sentence the sandboxed bridge uses. */
  it.each([
    "clearFileDecorations",
    "defineFileIcon",
    "setFileDecorations",
  ] as const)("refuses %s without filetree", async (method) => {
    const { ui } = context("sb", ["sidebar"]);
    const call =
      method === "clearFileDecorations"
        ? ui.clearFileDecorations()
        : method === "defineFileIcon"
          ? ui.defineFileIcon("a", "<svg/>")
          : ui.setFileDecorations([]);
    await expect(call).rejects.toThrow(fileTreeCapabilityMessage(method));
  });

  it("takes absolute paths only", async () => {
    await expect(
      context("tb", ["filetree"]).ui.setFileDecorations([
        { decoration: { badge: "1" }, path: "notes/a.md" },
      ]),
    ).rejects.toThrow(PATH_NOT_ABSOLUTE_MESSAGE);
  });
});

describe("unregisterPluginUI and file decorations (D15)", () => {
  /** What fails this: an unload that leaves the plugin's decorations or its icon rule behind. */
  it("removes the plugin's decorations, icons and icon rules", async () => {
    const ctx = context("tb", ["filetree"]);
    await ctx.ui.defineFileIcon("star", "<svg><path d='M0 0'/></svg>");
    await ctx.ui.setFileDecorations([
      { decoration: { icon: { svg: "star" } }, path: "/v/a.md" },
    ]);
    unregisterPluginUI("tb");
    expect(useFileDecorationStore.getState().merged.size).toBe(0);
    expect(iconClassOf("tb", "star")).toBeUndefined();
    expect(
      document.head.querySelector("style[data-baram-file-icons]"),
    ).toBeNull();
  });

  /** spec 0074 §2 "해제" — every unload path reaches the sweep above: `unloadPlugin`,
   *  `rollbackSandboxLoad` and `unwindAfterActivate` in the loader, `teardownBuiltin` in the lifecycle.
   *  What fails this: a call dropped from one of them, or a new caller to review. */
  it("is called by the four unload paths", () => {
    expect(unregisterCallSites()).toEqual({
      "plugins/plugin-lifecycle.ts": 1,
      "plugins/plugin-loader.ts": 3,
    });
  });
});

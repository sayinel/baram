// §392 spec 0071 §9 — the Sketch Pad example, loaded from disk and driven through the viewer it
// registers with the real `createExtensionContext`. jsdom has no layout, so every element sits
// in a zero-sized box at the origin and a pointer's client coordinates are its drawing
// coordinates at zoom 1.
import type { PluginFileViewer } from "../plugin-ui-store";
import type { PluginFileViewerContext, PluginManifest } from "../types";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createExtensionContext } from "../extension-context";
import { validateManifest } from "../manifest";
import { pluginTrustOf } from "../plugin-trust";
import { usePluginUIStore } from "../plugin-ui-store";

const DIR = resolve(__dirname, "../../../examples/plugins/sketch-pad");
const manifest = JSON.parse(
  readFileSync(resolve(DIR, "baram-plugin.json"), "utf8"),
) as PluginManifest;
const TWO = '{"version":1,"strokes":[[1,2,3,4],[5,6,7,8]]}';
let viewer: PluginFileViewer;

beforeAll(async () => {
  usePluginUIStore.setState({ fileViewers: [] });
  const mod = (await import(
    pathToFileURL(resolve(DIR, manifest.main)).href
  )) as { activate: (ctx: unknown) => void };
  mod.activate(createExtensionContext(manifest, DIR));
  viewer = usePluginUIStore.getState().fileViewers[0];
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** Mount the viewer on a fresh element; `text: null` mounts it draw-only (no ctx.edit). */
function mounted(text: null | string, tabId = "t1", zoomLevel = 1) {
  const el = document.createElement("div");
  document.body.append(el);
  const markChanged = vi.fn();
  const ctx: PluginFileViewerContext = {
    assetUrl: "asset://localhost/x.strokes",
    filePath: "/v/x.strokes",
    refreshKey: 0,
    zoomLevel,
    ...(text === null ? {} : { edit: { markChanged, tabId, text } }),
  };
  viewer.onMount(el, ctx);
  return { ctx, el, markChanged };
}

const lines = (el: HTMLElement) => el.querySelectorAll("polyline");
function pointer(el: HTMLElement, type: string, x: number, y: number): void {
  el.querySelector("svg")?.dispatchEvent(
    new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y }),
  );
}
const textOf = (el: HTMLElement) => viewer.getText?.(el);

describe("the Sketch Pad manifest", () => {
  it("is a valid trusted manifest holding exactly viewer and files", () => {
    const result = validateManifest(manifest);
    expect(result.valid ? [] : result.errors).toEqual([]);
    expect(pluginTrustOf(manifest)).toBe("trusted");
    expect(manifest.id).toBe("baram-sketch-pad");
    expect(manifest.main).toBe("index.mjs");
    expect([...manifest.capabilities].sort()).toEqual(["files", "viewer"]);
  });

  it("registers one editable viewer for .strokes, with getText", () => {
    expect(usePluginUIStore.getState().fileViewers).toHaveLength(1);
    expect(viewer.extensions).toEqual(["strokes"]);
    expect(viewer.editable).toBe(true);
    expect(typeof viewer.getText).toBe("function");
  });
});

describe("editing (§9)", () => {
  it("draws the strokes it is given and hands the same drawing back", () => {
    const { el } = mounted(TWO);
    expect(lines(el)).toHaveLength(2);
    expect(textOf(el)).toBe(TWO);
  });

  it("reports a change on every pointer move of a stroke, and the stroke is in getText", () => {
    const { el, markChanged } = mounted(TWO);
    pointer(el, "pointerdown", 10, 10);
    pointer(el, "pointermove", 20, 20);
    pointer(el, "pointermove", 30, 30);
    pointer(el, "pointerup", 30, 30);
    pointer(el, "pointermove", 40, 40);
    expect(markChanged).toHaveBeenCalledTimes(3);
    expect(JSON.parse(textOf(el) ?? "").strokes.at(-1)).toEqual([
      10, 10, 20, 20, 30, 30,
    ]);
  });

  it("shows text that is not a drawing read-only: no change reported, the text handed back as it was", () => {
    const { el, markChanged } = mounted("not a drawing");
    pointer(el, "pointerdown", 10, 10);
    pointer(el, "pointermove", 20, 20);
    expect(markChanged).not.toHaveBeenCalled();
    expect(textOf(el)).toBe("not a drawing");
    expect(el.querySelector(".sketch-pad-notice")?.hasAttribute("hidden")).toBe(
      false,
    );
  });

  it("treats an empty file as an empty drawing it can edit", () => {
    const { el, markChanged } = mounted("");
    expect(lines(el)).toHaveLength(0);
    pointer(el, "pointerdown", 10, 10);
    expect(markChanged).toHaveBeenCalledTimes(1);
    expect(textOf(el)).toBe('{"version":1,"strokes":[[10,10]]}');
  });

  it("keeps what is drawn for an onUpdate carrying its own text, and redraws for another text", () => {
    const { ctx, el, markChanged } = mounted(TWO);
    const first = lines(el)[0];
    viewer.onUpdate?.(el, {
      ...ctx,
      edit: { markChanged, tabId: "t1", text: TWO },
      zoomLevel: 1.5,
    });
    expect(lines(el)[0]).toBe(first);
    expect(el.querySelector("svg")?.getAttribute("width")).toBe("1200");
    viewer.onUpdate?.(el, {
      ...ctx,
      edit: {
        markChanged,
        tabId: "t1",
        text: '{"version":1,"strokes":[[9,9,8,8]]}',
      },
    });
    expect(lines(el)).toHaveLength(1);
  });

  it("keeps the pen width per tab across a remount", () => {
    const one = mounted(TWO, "t1");
    one.el.querySelector<HTMLButtonElement>('button[data-pen="6"]')?.click();
    expect(lines(one.el)[0].getAttribute("stroke-width")).toBe("6");
    viewer.onUnmount?.(one.el);
    const again = mounted(TWO, "t1");
    expect(lines(again.el)[0].getAttribute("stroke-width")).toBe("6");
    const other = mounted(TWO, "t2");
    expect(lines(other.el)[0].getAttribute("stroke-width")).toBe("3");
  });

  it("reads no layout in getText", () => {
    const { el } = mounted(TWO);
    const measure = vi.spyOn(Element.prototype, "getBoundingClientRect");
    textOf(el);
    expect(measure).not.toHaveBeenCalled();
  });

  it("removes the last stroke on Mod+Z and reports the change", () => {
    const { el, markChanged } = mounted(TWO);
    el.querySelector(".sketch-pad")?.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true }),
    );
    expect(lines(el)).toHaveLength(1);
    expect(markChanged).toHaveBeenCalledTimes(1);
  });
});

describe("without ctx.edit (§9 — older app, or a file editing is not open for)", () => {
  it("only draws, from the file on disk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ text: async () => TWO })),
    );
    const { el } = mounted(null);
    await vi.waitFor(() => expect(lines(el)).toHaveLength(2));
    pointer(el, "pointerdown", 10, 10);
    pointer(el, "pointermove", 20, 20);
    expect(lines(el)).toHaveLength(2);
    expect(
      el.querySelector(".sketch-pad-toolbar")?.hasAttribute("hidden"),
    ).toBe(true);
  });
});

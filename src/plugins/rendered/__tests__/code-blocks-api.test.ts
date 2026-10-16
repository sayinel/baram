// §394 spec 0073 §4 · D5 · D11 ③ · D17 · §6 — the trusted tier's ctx.codeBlocks and the claim both
// tiers make at load.
import type { PluginManifest } from "../../types";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createExtensionContext } from "../../extension-context";
import { promptRefusal, resetPromptGate } from "../../prompt-gate";
import { unregisterPluginUI } from "../../trusted/ui-api";
import {
  __resetCodeBlockRegistry,
  codeBlockRendererFor,
  onCodeBlockRegistryChange,
} from "../code-block-registry";
import {
  claimCodeBlocks,
  createCodeBlocksAPI,
  dispatchRenderedAction,
} from "../code-blocks-api";
import { __resetRenderQueue, onRendersInvalidated } from "../render-queue";

function manifest(
  id: string,
  langs: string[],
  capabilities = ["codeblocks"],
): PluginManifest {
  return {
    author: "a",
    capabilities: capabilities as PluginManifest["capabilities"],
    contributions: { codeBlocks: langs.map((lang) => ({ lang })) },
    description: "d",
    engines: { baram: ">=0.7.7" },
    id,
    license: "MIT",
    main: "index.mjs",
    name: id.toUpperCase(),
    trust: "trusted",
    version: "1.0.0",
  };
}

afterEach(() => {
  vi.useRealTimers();
  __resetCodeBlockRegistry();
  __resetRenderQueue();
  resetPromptGate();
});

const html = async () => ({ html: "<p>x</p>" });

describe("claims and register (D5 · §6)", () => {
  /** What fails this: last-wins ownership, or a register that does not check the claim. The
   *  messages carry the language and the drawing plugin's name (fixed sentences, §6). */
  it("lets the first loaded plugin draw and refuses the later one's register by name", () => {
    const first = createCodeBlocksAPI(
      "a",
      claimCodeBlocks(manifest("a", ["x"]), "trusted"),
      [],
    );
    const second = createCodeBlocksAPI(
      "b",
      claimCodeBlocks(manifest("b", ["x", "y"]), "trusted"),
      [],
    );
    first.register("x", html);
    expect(() => second.register("x", html)).toThrow(
      "codeBlocks.register: ```x is drawn by A",
    );
    second.register("y", html);
    expect(codeBlockRendererFor("x")?.pluginId).toBe("a");
    expect(codeBlockRendererFor("y")?.pluginId).toBe("b");
  });

  it("refuses a language the manifest did not declare", () => {
    const api = createCodeBlocksAPI(
      "a",
      claimCodeBlocks(manifest("a", ["x"]), "trusted"),
      [],
    );
    expect(() => api.register("z", html)).toThrow(
      'codeBlocks.register: "z" is not declared in contributions.codeBlocks',
    );
  });

  /** The registry tells listeners which languages changed — Task 10's editors listen. */
  it("announces register and dispose with the language, and forgets on dispose", () => {
    const changes: string[][] = [];
    const stop = onCodeBlockRegistryChange((langs) => changes.push([...langs]));
    const api = createCodeBlocksAPI(
      "a",
      claimCodeBlocks(manifest("a", ["x"]), "trusted"),
      [],
    );
    const registration = api.register("x", html);
    registration.dispose();
    stop();
    expect(changes).toEqual([["x"], ["x"]]);
    expect(codeBlockRendererFor("x")).toBeNull();
  });

  /** P24 — the unload sweep gives the languages back; another plugin may then claim them. */
  it("releases claims and bindings in unregisterPluginUI", () => {
    createCodeBlocksAPI(
      "a",
      claimCodeBlocks(manifest("a", ["x"]), "trusted"),
      [],
    ).register("x", html);
    unregisterPluginUI("a");
    expect(codeBlockRendererFor("x")).toBeNull();
    expect(claimCodeBlocks(manifest("b", ["x"]), "trusted")).toEqual([
      { drawnBy: null, lang: "x" },
    ]);
  });

  /** What fails this: a release that announces nothing — the editors would keep drawing with a
   *  renderer that is gone — or one that also announces a language claimed and never bound, which
   *  draws as a CodeMirror block before and after. A plugin that lost every language announces
   *  nothing at all. */
  it("announces on release the languages that were bound, and only those", () => {
    createCodeBlocksAPI(
      "a",
      claimCodeBlocks(manifest("a", ["x", "y"]), "trusted"),
      [],
    ).register("x", html);
    claimCodeBlocks(manifest("b", ["x", "y"]), "trusted");
    const changes: string[][] = [];
    const stop = onCodeBlockRegistryChange((langs) => changes.push([...langs]));
    unregisterPluginUI("b");
    unregisterPluginUI("a");
    stop();
    expect(changes).toEqual([["x"]]);
  });
});

describe("invalidate (§4 · D17 · §6)", () => {
  /** What fails this: invalidating another plugin's language (D17 — a lost language is a no-op),
   *  or accepting an undeclared one silently. */
  it("throws for an undeclared language, does nothing for a lost one, and invalidates its own", () => {
    vi.useFakeTimers();
    const seen: Array<[string, null | string[]]> = [];
    onRendersInvalidated((id, langs) => seen.push([id, langs && [...langs]]));
    createCodeBlocksAPI(
      "a",
      claimCodeBlocks(manifest("a", ["x"]), "trusted"),
      [],
    );
    const b = createCodeBlocksAPI(
      "b",
      claimCodeBlocks(manifest("b", ["x", "y"]), "trusted"),
      [],
    );
    expect(() => b.invalidate("z")).toThrow(
      'codeBlocks.invalidate: "z" is not declared in contributions.codeBlocks',
    );
    b.invalidate("x");
    vi.advanceTimersByTime(1_000);
    expect(seen).toEqual([]);
    b.invalidate("y");
    vi.advanceTimersByTime(1_000);
    expect(seen).toEqual([["b", ["y"]]]);
  });
});

describe("onAction — the second entrance of prompt rights (D11 ③)", () => {
  /** What fails this: dispatching outside `runPluginAction` — the handler would run without
   *  rights; the pair asserts they end with it. */
  it("runs the handler with prompt rights and ends them when it settles", async () => {
    const api = createCodeBlocksAPI(
      "a",
      claimCodeBlocks(manifest("a", ["x"]), "trusted"),
      [],
    );
    api.register("x", html);
    const during: Array<null | string> = [];
    api.onAction((action) => {
      during.push(promptRefusal("a"));
      expect(action).toEqual({
        action: "go",
        context: "c",
        lang: "x",
        path: "/v/a.md",
      });
    });
    await dispatchRenderedAction(codeBlockRendererFor("x")!, {
      action: "go",
      context: "c",
      lang: "x",
      path: "/v/a.md",
    });
    expect(during).toEqual([null]);
    expect(promptRefusal("a")).toMatch(/commands is running/);
  });
});

describe("ExtensionContext.codeBlocks (§4)", () => {
  /** What fails this: exposing the API without the capability. The pair: with it, `register`
   *  works. */
  it("is a denied proxy without codeblocks and the API with it", () => {
    const denied = createExtensionContext(manifest("a", [], []), "/p");
    expect(() => denied.codeBlocks.register("x", html)).toThrow(
      /requires "codeblocks" capability/,
    );
    const granted = createExtensionContext(manifest("b", ["x"]), "/p");
    granted.codeBlocks.register("x", html);
    expect(codeBlockRendererFor("x")?.pluginId).toBe("b");
  });
});

// §260 Phase 6 — the two reference plugins, guarded.
//
// They are loaded by hand, months apart, so a validator or API change would silently make
// them unloadable and the failure would surface during a scarce manual smoke. Same reason
// `sandbox-smoke-fixture.test.ts` exists; this file covers the two SHIPPED examples and the
// decisions Phase 6 made about them.
import type { PluginManifest, RegistryIndex } from "../types";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateManifest } from "../manifest";
import { pluginTrustOf } from "../plugin-trust";

const EXAMPLES = resolve(__dirname, "../../../examples/plugins");
const SEED = resolve(__dirname, "../../../registry/index.json");

const read = (dir: string, file: string) =>
  readFileSync(resolve(EXAMPLES, dir, file), "utf8");
const manifestOf = (dir: string) =>
  JSON.parse(read(dir, "baram-plugin.json")) as PluginManifest;
const seed = () => JSON.parse(readFileSync(SEED, "utf8")) as RegistryIndex;

/** Report WHY, not a bare `false` — otherwise the next reader guesses which rule broke. */
const invalidFields = (manifest: PluginManifest) => {
  const result = validateManifest(manifest);
  return result.valid
    ? []
    : result.errors.map((e) => `${e.field}: ${e.message}`);
};

describe("baram-word-count — the reference SANDBOXED plugin (§260 Phase 6)", () => {
  const manifest = manifestOf("word-count");
  /** The authored source — what an author reads and copies. */
  const source = read("word-count", "src/index.ts");
  /** What actually SHIPS. `dist/` is committed, so it can go stale independently. */
  const built = read("word-count", manifest.main);

  it("is a valid, sandboxed manifest the loader will accept", () => {
    expect(
      invalidFields(manifest),
      "the reference plugin must stay loadable",
    ).toEqual([]);
    expect(pluginTrustOf(manifest)).toBe("sandboxed");
  });

  it("holds exactly the three capabilities its code uses", () => {
    // `editor:readonly` not `editor`: a word counter never writes, and the readonly grant is
    // what makes this plugin also a demonstration of the any-of authorization.
    expect([...manifest.capabilities].sort()).toEqual([
      "editor:readonly",
      "events",
      "statusbar",
    ]);
  });

  it("requires the version that first had a sandboxed runtime", () => {
    // A user on 0.3.x installing this would load a plugin whose tier the app cannot run.
    expect(manifest.engines.baram).toBe(">=0.4.0");
  });

  it("addresses exactly the status-bar item it declares, through one constant", () => {
    // The host REFUSES `setStatusBarText` for an undeclared id, so a manifest and a source
    // that disagree leave the plugin silently showing nothing.
    const declared = (manifest.contributions?.statusBar ?? []).map((i) => i.id);
    expect(declared).toEqual(["count"]);

    // Read from the BUILT bundle, not the source: `dist/` is committed and can go stale, and
    // the bundle is what the host actually runs. esbuild keeps the binding name, only its
    // declaration keyword changes.
    const constants = [
      ...built.matchAll(/(?:const|var) ITEM = "([^"]+)"/g),
    ].map((m) => m[1]);
    expect(constants).toEqual(declared);

    // …and every call goes through that constant rather than a repeated literal, which is
    // what keeps the two in sync. Captures the first argument as written.
    const addressed = [
      ...built.matchAll(/setStatusBarText\(\s*([A-Za-z_$][\w$]*|"[^"]*")/g),
    ].map((m) => m[1]);
    expect(addressed).toEqual(["ITEM"]);
  });

  it("reads the document through the sandboxed editor surface", () => {
    // The whole set of editor calls, not a "does it mention getContent" scan: the source
    // DISCUSSES the trusted tier's `getContent()` in a comment explaining the port, so a
    // word-match would fail on prose. Matching `ctx.<member>(` matches syntax instead.
    // `getContent` is the trusted tier's synchronous reader and does not exist in this tier;
    // a leftover call would throw at runtime rather than fail to compile, because the
    // context is structural.
    const editorCalls = [...source.matchAll(/ctx\.editor\.(\w+)\s*\(/g)].map(
      (m) => m[1],
    );
    expect(editorCalls).toEqual(["getMarkdown"]);
    expect(source).toMatch(/await ctx\.editor\.getMarkdown\(\)/);
    // Asserted on the shipped bundle too — this is the cheap staleness check that a rebuilt
    // `dist/` was committed alongside the source change.
    expect(built).toMatch(/getMarkdown\(\)/);
    for (const event of ["editor:ready", "file:open", "file:save"]) {
      expect(built, `${event} must survive into the bundle`).toContain(event);
    }
  });

  it("exports activate and NOT deactivate", () => {
    // The sandboxed tier never calls `deactivate` — teardown destroys the webview realm — so
    // an exported one is dead code that reads as a lifecycle hook.
    expect(built).toMatch(/export\s*\{[^}]*\bactivate\b/);
    expect(built).not.toMatch(/\bdeactivate\b/);
  });

  it("ships a single self-contained ESM, and a build that cannot produce anything else", () => {
    // A blob: module has no base URL, so any surviving bare import fails at activate.
    expect(built).not.toMatch(/^\s*import\s/m);
    expect(built).not.toMatch(/\brequire\s*\(/);
    // The build must not mark anything external either — that is precisely how a bare
    // `import` ends up in the output (v1 externalized @tiptap/*, which this tier cannot use).
    const pkg = JSON.parse(read("word-count", "package.json")) as {
      scripts: { build: string };
    };
    expect(pkg.scripts.build).not.toContain("--external");
  });

  it("matches the committed registry seed", () => {
    // The seed is the offline snapshot of the live index; a released plugin whose seed entry
    // still names the old version is how the two silently diverge.
    const entry = seed().plugins.find((p) => p.id === manifest.id);
    expect(entry?.version).toBe(manifest.version);
    expect(entry?.trust).toBe("sandboxed");
    expect([...(entry?.capabilities ?? [])].sort()).toEqual(
      [...manifest.capabilities].sort(),
    );
  });
});

describe("baram-ai-summary — the trusted example, withdrawn from the registry", () => {
  const manifest = manifestOf("ai-summary");

  it("is a valid, trusted manifest", () => {
    // Declaring `trust` is what makes it loadable at all: `validateManifest` rejects a
    // manifest without one, so before Phase 6 this example could not even be dev-loaded.
    expect(invalidFields(manifest)).toEqual([]);
    expect(pluginTrustOf(manifest)).toBe("trusted");
  });

  it("is not in the registry index", () => {
    // §260 Phase 6 decision: it cannot be sandboxed (no declarative `sidebar` contribution
    // exists, and this tier has nowhere to show a summary), and publishing it as a TRUSTED
    // plugin would teach users to click through the full-trust warning for something as
    // ordinary as summarising a document. So it ships as a repo example only.
    expect(seed().plugins.map((p) => p.id)).not.toContain(manifest.id);
  });
});

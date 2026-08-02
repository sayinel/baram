// §260 Phase 6 — the two reference plugins, guarded.
//
// They are loaded by hand, months apart, so a validator or API change would silently make
// them unloadable and the failure would surface during a scarce manual smoke. Same reason
// `sandbox-smoke-fixture.test.ts` exists; this file covers the two SHIPPED examples and the
// decisions Phase 6 made about them.
import type { PluginManifest, RegistryIndex } from "../types";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

  it("requires a version that will actually SHIP the sandboxed runtime", () => {
    // §260 Phase 6 code review (H1) — this said `>=0.4.0`, which named two SHIPPED releases
    // that cannot run this plugin: v0.4.1 has no `sandbox-host.ts`, no `trust` in
    // `validateManifest`, and no legacy gate in the marketplace. There, Install is ENABLED and
    // the bundle loads in the MAIN realm against a trusted `ExtensionContext` that has neither
    // `ui.setStatusBarText` nor `editor.getMarkdown`, so `activate` throws — and for someone
    // holding v1.0.0, the pre-fix `handleUpdate` destroys a working plugin to install that.
    //
    // ‼️ `engines` is NOT ENFORCED: `manifest.ts` only requires `engines.baram` to be a
    // non-empty string, and nothing anywhere compares versions. So this field is a claim to a
    // human, and the protection is the RELEASE ORDER — the app version carrying Phases 5-6
    // must ship before the plugin tag is pushed. Asserting the floor here at least keeps the
    // claim from silently naming a version that cannot run it.
    // NOT compared against `package.json`: an earlier version of this guard required the floor
    // to be ahead of the app version, which would have broken the moment the app was bumped to
    // 0.5.0 — a guard that fails on the very release it exists to wait for.
    //
    // NOR pinned to an exact string (round-2 LOW): that demanded `>=0.5.0` forever, so
    // legitimately raising the floor later — because the plugin starts using something added in
    // 0.6.0 — would fail a test that would have to be "fixed" by reverting a correct change.
    // The invariant is the fixed historical fact: v0.4.1 was the last release shipped WITHOUT the
    // sandboxed tier, so the floor must be strictly above it.
    const LAST_RELEASE_WITHOUT_THE_TIER = [0, 4, 1];
    const parse = (range: string) =>
      range
        .replace(/^[^\d]*/, "")
        .split(".")
        .map(Number);
    const floor = parse(manifest.engines.baram);
    expect(
      floor.length,
      `engines.baram ${manifest.engines.baram} must name a full version`,
    ).toBe(3);
    // Plain lexicographic compare on [major, minor, patch] — no semver dependency, and simple
    // enough to be obviously right.
    const isAbove = (a: number[], b: number[]) =>
      a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
    expect(
      isAbove(floor, LAST_RELEASE_WITHOUT_THE_TIER),
      `engines.baram ${manifest.engines.baram} must be above 0.4.1, the last release without ` +
        "the sandboxed tier — any floor at or below it names a build that cannot run this plugin",
    ).toBe(true);

    // …and the SAME floor in all three places it is written. The README ships inside the release
    // ZIP (`plugin-release.yml` packages `baram-plugin.json dist README.md`), so a stale copy
    // there is a claim the user reads — round 2 found exactly that: the manifest said `>=0.5.0`
    // while the README still told users `>=0.4.0`, and nothing compared them.
    const entry = seed().plugins.find((p) => p.id === manifest.id);
    // `engines?` is optional on `RegistryEntry` so that a foreign entry omitting it costs
    // only its own floor check rather than the whole index — but this seed is FIRST-PARTY,
    // and an absent floor here must still fail: `undefined` cannot equal the manifest's
    // range string, so the optional chain reports the omission rather than skipping the test.
    expect(entry?.engines?.baram, "the seed must agree").toBe(
      manifest.engines.baram,
    );
    // §260 Phase 6 code review round 3 (LOW-2) and round 5 (MEDIUM-2). BOTH properties, because
    // round 4's "fix" traded one for the other: anchoring the scan to `engines.baram` stopped it
    // seeing a contradictory unanchored floor elsewhere in the README — re-opening the very defect
    // round 3 created the guard for — and broke on a legitimate rewording that put the floor before
    // the anchor. So:
    //   (a) EVERY Baram floor the README states must be the manifest's, and
    //   (b) at least one of them must sit next to `engines.baram`, so the claim is actually made.
    // A future Node floor is excluded by name rather than by dropping (a).
    const readme = read("word-count", "README.md");
    const floorOf = (range: string) => range.replace(/^[^\d>]*/, "");
    const allFloors = [
      ...new Set(
        [
          ...readme.matchAll(/(?<![Nn]ode[^\n]{0,20})(>=\s*\d+\.\d+\.\d+)/g),
        ].map((m) => m[1].replace(/\s+/, "")),
      ),
    ];
    expect(
      allFloors,
      "the README ships in the ZIP, so every Baram floor it names must be the manifest's",
    ).toEqual([floorOf(manifest.engines.baram)]);
    expect(
      readme,
      "the README must actually state the engines.baram floor, not merely avoid contradicting it",
    ).toMatch(/engines\.baram`?[\s\S]{0,60}?>=\s*\d+\.\d+\.\d+/);
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
  });

  it("ships a dist/ that was rebuilt from the current source", () => {
    // §260 Phase 6 code review round 2 (M2) — this test has now been wrong TWICE, in the same
    // direction: it asserted a handful of extracted facts and called that "rebuilt". Round 1's
    // version was strictly weaker than its source-side twin (edit + no rebuild stayed green);
    // round 2's comparison of three facts still missed renaming `ITEM`, changing the word count
    // to `length - 1`, and counting `trimmed.length` instead of `text.length` — all
    // source-only edits that shipped a stale bundle. It also produced FALSE failures, because
    // esbuild escapes above U+00FF as `\uNNNN` (not just `\xNN`), so localizing the separator
    // and rebuilding correctly reported "stale".
    //
    // Comparing extracted facts cannot prove "rebuilt". So rebuild, and compare bytes. esbuild
    // is a root devDependency, so no `npm ci` in the example is needed, and `absWorkingDir`
    // reproduces the path comment esbuild embeds (`// src/index.ts`) — without it the output
    // differs by that line alone.
    const dir = resolve(EXAMPLES, "word-count");
    const pkg = JSON.parse(read("word-count", "package.json")) as {
      devDependencies: { esbuild: string };
      scripts: { build: string };
    };

    // §260 Phase 6 code review round 3 (LOW-1) — the flags come FROM the build script, not from
    // a copy of them here. Hardcoding `{bundle, format}` meant an honest `--charset=utf8` or
    // `--banner:js=…` in the example produced a false "stale" — and `--charset=utf8` is exactly
    // the remedy for the `\uNNNN` escaping round 2 ran into. Only the output path is redirected.
    const args = pkg.scripts.build.trim().split(/\s+/);
    expect(args[0], "the build script must invoke esbuild directly").toBe(
      "esbuild",
    );
    const out = join(mkdtempSync(join(tmpdir(), "baram-wc-")), "index.mjs");
    const rebuildArgs = args
      .slice(1)
      .map((a) => (a.startsWith("--outfile=") ? `--outfile=${out}` : a));
    expect(
      rebuildArgs.some((a) => a.startsWith("--outfile=")),
      "the build script must name an --outfile for this test to redirect",
    ).toBe(true);

    // Run the real esbuild BINARY, in a child process with the example as cwd. Both details
    // matter: esbuild's `buildSync` refuses to run under vitest's jsdom ("your JavaScript
    // environment is broken"), and the cwd is what reproduces the path comment esbuild embeds
    // (`// src/index.ts`) — from anywhere else the output differs by that line alone.
    const result = spawnSync(
      resolve(__dirname, "../../../node_modules/esbuild/bin/esbuild"),
      rebuildArgs,
      { cwd: dir, encoding: "utf8" },
    );
    // If the binary itself is missing, `spawnSync` reports `error` with a null status and an
    // undefined stderr — the message then read "must succeed:\nundefined" (round-4 LOW-3).
    // Rethrow the real cause instead of diagnosing a build that never ran.
    if (result.error) throw result.error;
    // Judged by EXIT STATUS, not by empty stderr: the esbuild CLI writes its success summary
    // ("dist/index.mjs 574b … Done in 7ms") to stderr, so an emptiness check fails on success.
    expect(
      result.status,
      `the rebuild itself must succeed:\n${result.stderr}`,
    ).toBe(0);
    const fresh = readFileSync(out, "utf8");

    // §260 Phase 6 code review round 3 (MEDIUM-3) — a mismatch has two possible causes, and the
    // message must not assert the wrong one. The previous version hard-failed on an esbuild
    // version skew with "align them", which a routine dependabot bump of the ROOT would trigger
    // (dependabot does not watch `examples/plugins/*`). Both versions are named here so the
    // reader can tell staleness from a compiler change.
    const rootEsbuild = (
      JSON.parse(
        readFileSync(
          resolve(__dirname, "../../../node_modules/esbuild/package.json"),
          "utf8",
        ),
      ) as { version: string }
    ).version;
    expect(
      fresh,
      `dist/index.mjs does not match a fresh build. Most likely it is stale — run ` +
        `\`npm run build\` in examples/plugins/word-count and commit it. If you have not touched ` +
        `the source, check for an esbuild change instead: this ran ${rootEsbuild} (repo root) ` +
        `while the example declares ${pkg.devDependencies.esbuild}.`,
    ).toBe(built);
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
    // §260 Phase 6 code review (L2) — `export { x } from "./sibling.mjs"` is a static
    // bare-specifier import that both patterns above miss, and it fails the same way.
    expect(built).not.toMatch(/^\s*export\b[^;]*\bfrom\s/m);
    const pkg = JSON.parse(read("word-count", "package.json")) as {
      scripts: { build: string };
    };
    // The build must not mark anything external either — that is precisely how a bare
    // `import` ends up in the output (v1 externalized @tiptap/*, which this tier cannot use).
    expect(pkg.scripts.build).not.toContain("--external");
    // §260 Phase 6 code review (L3) — nor minify. Minifying is legitimate for a plugin, but the
    // guards above read identifiers and template literals out of the bundle, so it would turn
    // them into false failures. If minifying ever becomes worth it, rewrite those to compare
    // behaviour rather than text — do not just delete this line.
    expect(pkg.scripts.build).not.toContain("--minify");
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

describe("the plugin guide's copy-paste examples are valid (§260 Phase 6)", () => {
  // §260 Phase 6 code review round 2, pre-existing finding: the guide's headline
  // `baram-plugin.json` example omitted `trust` — which the same document calls required — and
  // both examples used `engines.baram: ">=0.3.0"`, the class of claim H1 ruled false. An author
  // copying either got something `validateManifest` rejects. Nothing compared the prose to the
  // validator, so this guards the examples themselves rather than the sentence about them.
  const guide = readFileSync(
    resolve(__dirname, "../../../docs/plugin-development.md"),
    "utf8",
  );
  // §260 Phase 6 code review round 3 (MEDIUM-4) — collected as TEXT and parsed inside each
  // `it`. Parsing at module scope threw at COLLECTION time on a malformed block, which vitest
  // reports as "0 test" for the whole file — silently deleting all twelve word-count guards,
  // including the dist-staleness guard this round exists to protect, behind a bare SyntaxError
  // naming neither the document nor the block.
  const rawBlocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map(
    (m) => m[1],
  );
  const parsed = () =>
    rawBlocks.map((text, i) => {
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch (err) {
        // `cause` preserves the SyntaxError's position, which is the part that says WHERE.
        throw new Error(
          `docs/plugin-development.md json block #${i + 1} is not valid JSON`,
          { cause: err },
        );
      }
    });

  it("has manifest examples, and every one of them validates", () => {
    // A manifest example is one naming an entry point; a registry entry names a download.
    const manifests = parsed().filter(
      (b) => "main" in b && "id" in b,
    ) as unknown as PluginManifest[];
    // An exact count, not `> 0`: a guide that lost an example, or a regex that stopped
    // matching one, would otherwise still pass by validating fewer.
    expect(manifests).toHaveLength(1);
    for (const m of manifests) {
      expect(
        invalidFields(m),
        `the example for "${m.id}" must validate`,
      ).toEqual([]);
    }
  });

  it("has registry-entry examples that declare a tier", () => {
    const entries = parsed().filter((b) => "downloadUrl" in b);
    expect(entries).toHaveLength(1);
    for (const e of entries) {
      // An entry without one is exactly the legacy shape Install refuses, so an example of it
      // teaches an author to publish something nobody can install.
      expect(
        e.trust,
        `the entry example for "${String(e.id)}" needs a tier`,
      ).toBe("sandboxed");
    }
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

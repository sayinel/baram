import type { PluginManifest } from "../types";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateManifest } from "../manifest";
import { pluginTrustOf } from "../plugin-trust";

// §260 Phase 3c-3 — the live smoke fixture is the only way the sandboxed runtime gets
// exercised outside unit tests, and it is loaded by hand, months apart. Without this,
// a validator change would silently make it unloadable and the failure would surface
// as a confusing install error during a scarce user-run smoke.
const dir = resolve(__dirname, "../../../examples/plugins/sandbox-smoke");

describe("sandbox smoke fixture (§260 3c-3)", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(dir, "baram-plugin.json"), "utf8"),
  ) as PluginManifest;

  it("is a valid, sandboxed manifest the loader will accept", () => {
    const result = validateManifest(manifest);
    // Report WHY on failure — a bare `false` would send the next reader to the
    // validator to guess which rule the fixture broke.
    expect(
      result.valid ? [] : result.errors.map((e) => `${e.field}: ${e.message}`),
      "the fixture must stay loadable",
    ).toEqual([]);
    expect(pluginTrustOf(manifest)).toBe("sandboxed");
  });

  it("declares both commands the README tells the tester to run", () => {
    // Two, not one (§260 3c-3 code review, M3): `CALL_TIMEOUT_MS` bounds the whole
    // command at 30s while one mediated `ai` request may take up to 120s, so folding
    // the AI checks into `run` let a slow model discard every boundary result that
    // had already passed.
    expect(manifest.contributions?.commands?.map((c) => c.id)).toEqual([
      "run",
      "ai",
    ]);
  });

  it("hard-codes no local path at all", () => {
    // §260 3c-3 code review (M1): this fixture once shipped the maintainer's absolute
    // home path to a public repo, as the `VAULT_DIR` a tester had to edit. Phase 4a
    // removed the need — paths are context-relative and the open file arrives in an
    // event — so the guard is now the stronger one: no absolute path in the source.
    const source = readFileSync(resolve(dir, manifest.main), "utf8");
    expect(source).not.toMatch(/"\/(Users|home)\//);
    expect(source).not.toMatch(/[A-Za-z]:\\\\/);
    // The one absolute-looking string that belongs here is the path the fixture expects
    // to be REFUSED, which is the point of the `abs` check.
    expect(source).toMatch(/readFile\("\/etc\/hosts"\)/);
  });

  it("grants exactly the capabilities the checks need — including readonly files", () => {
    // `files:readonly` rather than `files` is load-bearing: it keeps the smoke
    // non-destructive AND lets the fixture prove the any-of authorization (a read is
    // admitted, a write is refused). Widening this to `files` would silently turn the
    // "ro✓" check into a real write into the tester's vault.
    expect([...manifest.capabilities].sort()).toEqual([
      "ai",
      "commands",
      // §260 Phase 4a — `events` is how it learns a path at all, and `statusbar` is how
      // it reports; without them the fixture is back to throwing to be heard.
      "events",
      "files:readonly",
      "statusbar",
      "storage",
    ]);
  });

  it("declares the status-bar items it addresses at runtime", () => {
    // The host refuses `setStatusBarText` for an id that is not declared, so a
    // fixture whose manifest and code disagree would report nothing and look broken.
    const declared = (manifest.contributions?.statusBar ?? []).map((i) => i.id);
    expect(declared).toEqual(["smoke", "file"]);
    const source = readFileSync(resolve(dir, manifest.main), "utf8");
    for (const id of declared) {
      expect(source).toContain(`setStatusBarText("${id}"`);
    }
    // …and it deliberately calls one UNDECLARED id, to show the refusal in the console.
    expect(source).toContain('setStatusBarText("not-declared"');
  });

  it("ships a single self-contained ESM — no imports, since a blob module has no base URL", () => {
    expect(manifest.main).toBe("index.mjs");
    const source = readFileSync(resolve(dir, manifest.main), "utf8");
    // A bare `import`/`require` would resolve against the blob URL and fail at
    // activate; `export` is fine (that is how `activate` is found).
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).toMatch(/export async function activate\s*\(/);
  });
});

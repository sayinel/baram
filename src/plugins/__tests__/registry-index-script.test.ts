// §260 Phase 6 — the release pipeline must carry `trust` into the registry index.
//
// WHY THIS FILE EXISTS: `scripts/update-registry-index.mjs` builds each entry from an
// allowlist of manifest fields, and `trust` was not in it. Both live entries therefore
// lacked `trust`, and Phase 5 reads a `trust`-less entry as LEGACY and disables Install —
// so the shipped registry had zero installable plugins. Nothing failed; the pipeline
// published a dead entry and said "upserted".
//
// The script is plain Node, run by the workflow, so it is exercised the way the workflow
// runs it: as a child process, asserting the exit code and what it wrote.
import type { RegistryEntry } from "../types";

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve(__dirname, "../../../scripts/update-registry-index.mjs");
const BASE_URL = "https://sayinel.github.io/baram-plugins/";
const CHECKSUM = "a".repeat(64);

/** A manifest the script accepts, so each test can break exactly one field. */
const VALID_MANIFEST = {
  author: "Baram",
  capabilities: ["editor:readonly", "events", "statusbar"],
  description: "Counts words.",
  engines: { baram: ">=0.4.0" },
  id: "baram-word-count",
  license: "Apache-2.0",
  main: "dist/index.mjs",
  name: "Word Count",
  trust: "sandboxed",
  version: "2.0.0",
};

function run(
  manifest: Record<string, unknown>,
  index: { plugins: unknown[] } = { plugins: [] },
): { entry?: RegistryEntry; status: null | number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "baram-registry-"));
  const manifestPath = join(dir, "baram-plugin.json");
  const indexPath = join(dir, "index.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  writeFileSync(indexPath, JSON.stringify(index));

  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--index",
      indexPath,
      "--manifest",
      manifestPath,
      "--zip-name",
      `${String(manifest.id)}-${String(manifest.version)}.zip`,
      "--checksum",
      CHECKSUM,
      "--base-url",
      BASE_URL,
    ],
    { encoding: "utf8" },
  );

  // Read back only on success: a failing run must leave the index untouched, and parsing
  // it unconditionally would hide a partial write behind a JSON error.
  const written =
    result.status === 0
      ? (JSON.parse(readFileSync(indexPath, "utf8")) as {
          plugins: RegistryEntry[];
        })
      : undefined;
  return {
    entry: written?.plugins.find((p) => p.id === manifest.id),
    status: result.status,
    stderr: result.stderr,
  };
}

describe("update-registry-index carries the trust tier (§260 Phase 6)", () => {
  it("writes trust alongside capabilities", () => {
    const { entry, status } = run(VALID_MANIFEST);
    expect(status).toBe(0);
    // BOTH halves: consent is (trust, capabilities), and the shipped defect was one
    // present and the other absent — asserting only `trust` would have passed before too.
    expect(entry?.trust).toBe("sandboxed");
    expect(entry?.capabilities).toEqual([
      "editor:readonly",
      "events",
      "statusbar",
    ]);
  });

  it("carries the trusted tier too, not just the one the reference plugin uses", () => {
    const { entry, status } = run({ ...VALID_MANIFEST, trust: "trusted" });
    expect(status).toBe(0);
    expect(entry?.trust).toBe("trusted");
  });

  it("refuses a manifest with no trust field, naming it", () => {
    const noTrust: Record<string, unknown> = { ...VALID_MANIFEST };
    delete noTrust.trust;
    const { status, stderr } = run(noTrust);
    expect(status).toBe(1);
    // The MESSAGE is asserted, not just the exit code: the value check below would also
    // refuse `undefined`, so a bare exit-code assertion would still pass with `trust`
    // deleted from MANIFEST_REQUIRED — i.e. it would pin nothing.
    expect(stderr).toContain("missing required field: trust");
  });

  it("refuses an unknown tier", () => {
    const { status, stderr } = run({
      ...VALID_MANIFEST,
      trust: "semi-trusted",
    });
    expect(status).toBe(1);
    expect(stderr).toContain('must be one of "sandboxed", "trusted"');
    expect(stderr).toContain('"semi-trusted"'); // says what it got
  });

  it("refuses a non-string tier rather than coercing it", () => {
    const { status, stderr } = run({ ...VALID_MANIFEST, trust: true });
    expect(status).toBe(1);
    expect(stderr).toContain("must be one of");
  });

  it("replaces an existing entry for the same id, trust included", () => {
    // The upsert path is how a re-release lands, so it is the path that has to stop
    // carrying a stale tier forward.
    const stale = {
      capabilities: ["editor:readonly"],
      id: "baram-word-count",
      trust: "trusted",
      version: "1.0.1",
    };
    const { entry, status } = run(VALID_MANIFEST, { plugins: [stale] });
    expect(status).toBe(0);
    expect(entry?.trust).toBe("sandboxed");
    expect(entry?.version).toBe("2.0.0");
  });
});

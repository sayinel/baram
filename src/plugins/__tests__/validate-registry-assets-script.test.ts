// §69 — the publish gate that opens the archives, which is the one `validate-index.ts`
// structurally cannot be.
//
// WHY THIS FILE EXISTS: the index and the ZIPs it names live in DIFFERENT REPOSITORIES. The
// app repo has the validator and no archives; `sayinel/baram-plugins` has the archives and,
// until now, no CI at all. So the two failures a user meets most directly — the entry points
// at a file that is not there, or at a file whose sha256 is not the one declared — deployed
// cleanly past every gate and were discovered by users failing to install.
//
// Run as a child process the way the workflow runs it, asserting the exit code AND the
// specific message: the script has four ways to reject a registry and "it rejected" would
// not tell them apart.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const SCRIPT = resolve(ROOT, "scripts/validate-registry-assets.ts");
const TSX = resolve(ROOT, "node_modules/.bin/tsx");
const BASE = "https://sayinel.github.io/baram-plugins/";

const ZIP = Buffer.from("PK pretend this is an archive");
const ZIP_SHA = createHash("sha256").update(ZIP).digest("hex");

/**
 * Build a registry checkout on disk and run the script over it.
 *
 * `archives` names the files that exist under `plugins/`; the index is whatever the caller
 * passes. Keeping the two independent is the whole point — every defect this catches is a
 * disagreement between them.
 */
function run(
  entries: Record<string, unknown>[],
  archives: string[] = ["baram-word-count-1.0.0.zip"],
): { output: string; status: null | number } {
  const dir = mkdtempSync(join(tmpdir(), "baram-registry-"));
  mkdirSync(join(dir, "plugins"));
  for (const name of archives) writeFileSync(join(dir, "plugins", name), ZIP);
  writeFileSync(
    join(dir, "index.json"),
    JSON.stringify({ plugins: entries, updatedAt: "2026-08-02" }),
  );
  const result = spawnSync(TSX, [SCRIPT, dir], { encoding: "utf8" });
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

/** An entry the script accepts, so each case can break exactly one thing. */
function validEntry(overrides: Record<string, unknown> = {}) {
  return {
    checksum: ZIP_SHA,
    downloadUrl: `${BASE}plugins/baram-word-count-1.0.0.zip`,
    id: "baram-word-count",
    ...overrides,
  };
}

describe("validate-registry-assets", () => {
  it("accepts an index whose archives are all present and matching", () => {
    const { output, status } = run([validEntry()]);
    expect(status).toBe(0);
    expect(output).toContain("1 archive(s) present and matching");
  });

  it("refuses an entry whose archive is not in the registry", () => {
    const { output, status } = run([
      validEntry({ downloadUrl: `${BASE}plugins/missing-9.9.9.zip` }),
    ]);
    expect(status).toBe(1);
    expect(output).toContain(
      "plugins/missing-9.9.9.zip is not in the registry",
    );
    // The consequence, not just the fact — this is what the operator needs to act on.
    expect(output).toContain("404 on every install");
  });

  it("refuses an entry whose checksum does not match the archive", () => {
    const { output, status } = run([validEntry({ checksum: "b".repeat(64) })]);
    expect(status).toBe(1);
    // Both hashes, so the operator can see which one is stale without hashing by hand.
    expect(output).toContain(ZIP_SHA);
    expect(output).toContain("b".repeat(64));
    expect(output).toContain("every install fails");
  });

  it("refuses an archive hosted outside the registry rather than skipping it", () => {
    // ‼️ The silent-pass shape this exists to avoid: an entry the script cannot hash must
    // not be reported as checked. A warning here would mean exit 0 over an unverified
    // archive, which is exactly the outcome every other gate in this repo is written
    // against.
    const { output, status } = run([
      validEntry({ downloadUrl: "https://evil.example.com/word-count.zip" }),
    ]);
    expect(status).toBe(1);
    expect(output).toContain("is not under");
    expect(output).toContain("no gate has ever checked");
  });

  it("says nothing about a SUPERSEDED archive", () => {
    // Every update leaves the previous version behind. Warning about those would fire once
    // per release forever and bury the withdrawal case below.
    const { output, status } = run(
      [validEntry()],
      ["baram-word-count-1.0.0.zip", "baram-word-count-0.9.0.zip"],
    );
    expect(status).toBe(0);
    expect(output).not.toContain("baram-word-count-0.9.0.zip");
    expect(output).not.toContain("warning");
  });

  it("warns about an archive belonging to no listed plugin", () => {
    // The withdrawal path: `baram-ai-summary` was pulled from the live index and its ZIP is
    // still served. That is reachable by direct URL and should be a deliberate choice.
    const { output, status } = run(
      [validEntry()],
      ["baram-word-count-1.0.0.zip", "baram-ai-summary-1.0.0.zip"],
    );
    expect(status).toBe(0);
    expect(output).toContain("baram-ai-summary-1.0.0.zip");
    expect(output).toContain("belongs to no listed plugin");
  });

  it("leaves type complaints to validate-index rather than repeating them", () => {
    // The two scripts run together in the same job. One message per defect.
    const { status } = run([{ id: "broken" }]);
    expect(status).toBe(0);
  });

  it("cannot be made to forge a workflow annotation through an id", () => {
    // §69 security review (LOW-1). This script echoes ids and runs in Actions, so the
    // document it judges must not be able to write the verdict.
    const { output, status } = run([
      validEntry({
        downloadUrl: `${BASE}plugins/missing.zip`,
        id: "x\n::error title=forged::everything is fine",
      }),
    ]);
    expect(status).toBe(1);
    expect(output).not.toContain("::error title=forged::");
    expect(output).toContain("∷error");
  });
});

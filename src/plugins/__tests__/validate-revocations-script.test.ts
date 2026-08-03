// §69 — the withdrawal list's publish gate, which this PR newly points at untrusted input.
//
// WHY THIS FILE EXISTS: `scripts/validate-revocations.ts` had no test of its own, which was
// defensible while it only ever read `registry/revoked.json` in this repo — a first-party
// file. The registry repo's new `validate.yml` runs it over a `revoked.json` that a PR
// controls, and the script echoes entry ids into a GitHub Actions log.
//
// That combination is the one the security review flagged: an id containing a newline and
// `::error title=…::` wrote a forged annotation on a job that EXITS 0, and
// `::stop-commands::` silenced every genuine annotation after it.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const SCRIPT = resolve(ROOT, "scripts/validate-revocations.ts");
const TSX = resolve(ROOT, "node_modules/.bin/tsx");

function run(document: unknown): { output: string; status: null | number } {
  const dir = mkdtempSync(join(tmpdir(), "baram-revoked-"));
  const path = join(dir, "revoked.json");
  writeFileSync(path, JSON.stringify(document));
  const result = spawnSync(TSX, [SCRIPT, path], { encoding: "utf8" });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

describe("validate-revocations", () => {
  it("accepts the shape the registry actually ships", () => {
    const { status } = run({ revoked: [], version: 1 });
    expect(status).toBe(0);
  });

  it("refuses the document `null` with a sentence, not a stack trace", () => {
    // ‼️ `null` is a valid one-word JSON document, and reading `.revoked` off it threw an
    // uncaught TypeError instead of the refusal below. This script is pointed at a
    // PR-controlled file by the registry's `validate.yml`, and the sibling
    // `validate-registry-assets.ts` had copied the same line.
    const { output, status } = run(null);
    expect(status).toBe(1);
    expect(output).toContain("no `revoked` array");
    expect(output).not.toContain("TypeError");
  });

  it("cannot be made to forge a workflow annotation through an entry id", () => {
    // ‼️ The warning path at the heart of this: an entry whose range matches no probe
    // version is REPORTED AND ACCEPTED, so the forged annotation would ride along with a
    // green check — strictly worse than a refusal, because the job looks fine.
    //
    // Asserted per line, because Actions only interprets a workflow command at the start
    // of one. "the payload string is absent" would be satisfied by half a sanitizer.
    const { output, status } = run({
      revoked: [
        {
          id: "x\n::error title=forged::pwned\n::stop-commands::deadbeef\ny",
          reason: "r",
          severity: "malicious",
          versions: { gt: "99.99.99" },
        },
      ],
      version: 1,
    });
    expect(status).toBe(0);
    for (const line of output.split("\n")) {
      expect(line.trimStart()).not.toMatch(/^::/u);
    }
  });
});

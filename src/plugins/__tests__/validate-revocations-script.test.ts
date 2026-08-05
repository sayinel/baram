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
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const SCRIPT = resolve(ROOT, "scripts/validate-revocations.ts");
const SEQUENCE_SCRIPT = resolve(ROOT, "scripts/revocation-sequence.ts");
const TSX = resolve(ROOT, "node_modules/.bin/tsx");

function run(document: unknown): { output: string; status: null | number } {
  const result = spawnSync(TSX, [SCRIPT, write(document)], {
    encoding: "utf8",
  });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

/** What the publish gate reads — stdout ALONE, exactly as `$(...)` would capture it. */
function sequenceOf(document: unknown): {
  status: null | number;
  stdout: string;
} {
  const result = spawnSync(TSX, [SEQUENCE_SCRIPT, write(document)], {
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout.trim() };
}

function write(document: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "baram-revoked-"));
  const path = join(dir, "revoked.json");
  writeFileSync(path, JSON.stringify(document));
  return path;
}

describe("validate-revocations", () => {
  it("accepts the shape the registry actually ships", () => {
    const { status } = run({ revoked: [], version: 1 });
    expect(status).toBe(0);
  });

  it("REFUSES a list larger than the app will ever fetch", () => {
    // ‼️ THE ONLY FAIL-OPEN LEFT IN THE PUBLISH PATH (security review MEDIUM-2). Rust caps the
    // fetch at `MAX_REVOCATION_BYTES`, and nothing here measured size — so a padded `reason` would
    // validate, sign, verify and publish green, and then every client's fetch would error. No new
    // revocation would ever land and a fresh install would receive none at all. One merged PR is
    // the whole capability, and since it is not a Rust change the rust job need not even run.
    const { output, status } = run({
      revoked: [
        {
          id: "x",
          reason: "y".repeat(1024 * 1024),
          severity: "unlisted",
          versions: "*",
        },
      ],
      sequence: 1,
      version: 1,
    });
    expect(status).toBe(1);
    // The number is the cross-language contract: the script reads it out of the Rust that enforces
    // it, so seeing 1048576 here is what says the scrape found the constant rather than a factor
    // of it.
    expect(output).toContain("exceeds the 1048576");
  });

  it("refuses a path it cannot read with a sentence, not a stack trace", () => {
    // ‼️ THE NEW SIZE CHECK REINTRODUCED THE STACK TRACE THIS FILE FORBIDS (code review MEDIUM-4).
    // `statSync` sits above the JSON read, so before the fix a missing path threw out of node with a
    // trace — reachable from the workflow by a path typo, or by a `live.json` the curl never wrote.
    const result = spawnSync(TSX, [SCRIPT, "/nonexistent/revoked.json"], {
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain("cannot be read");
    // The anti-property, named: a node trace instead of a sentence.
    expect(output).not.toContain("at statSync");
  });

  it("accepts a list of exactly the cap, which the app also accepts", () => {
    // ‼️ THE BOUNDARY, and it matches Rust exactly: `fetch_capped_text` errors when
    // `buf.len() + chunk.len() > cap`, so a body of exactly `cap` bytes is fetched fine. A `>=` slip
    // here would refuse a list every client can read (code review LOW-7).
    const cap = 1024 * 1024;
    const padding = "y".repeat(cap - 200);
    const document = {
      revoked: [
        { id: "x", reason: padding, severity: "unlisted", versions: "*" },
      ],
      sequence: 1,
      version: 1,
    };
    const path = write(document);
    const size = statSync(path).size;
    // Pad to the cap exactly, keeping the JSON valid by growing `reason`.
    const grown = JSON.parse(readFileSync(path, "utf8")) as typeof document;
    grown.revoked[0].reason = padding + "y".repeat(cap - size);
    writeFileSync(path, JSON.stringify(grown));
    expect(statSync(path).size).toBe(cap);
    const result = spawnSync(TSX, [SCRIPT, path], { encoding: "utf8" });
    expect(result.status).toBe(0);
  });

  it("REFUSES a list one byte over the cap", () => {
    // ‼️ `size > cap` loosened to `size > cap + 1` survived (third-round code review LOW-3): the
    // exactly-at-cap case pins one side of the boundary and nothing pinned the other. Rust errors
    // when `buf.len() + chunk.len() > cap`, so cap+1 is refused by every client and would have
    // published green.
    const cap = 1024 * 1024;
    const path = write({
      revoked: [
        {
          id: "x",
          reason: "y".repeat(cap),
          severity: "unlisted",
          versions: "*",
        },
      ],
      sequence: 1,
      version: 1,
    });
    const document = JSON.parse(readFileSync(path, "utf8")) as {
      revoked: { reason: string }[];
    };
    document.revoked[0].reason = "y".repeat(
      cap - statSync(path).size + cap + 1,
    );
    writeFileSync(path, JSON.stringify(document));
    expect(statSync(path).size).toBe(cap + 1);
    const result = spawnSync(TSX, [SCRIPT, path], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("exceeds the 1048576");
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

  // ‼️ The counter is the ONE field the app reads forgivingly and the publisher must write
  // exactly (code review HIGH-2). `readSequence` turns anything malformed into 0 so a garbled
  // value loses the rollback comparison rather than winning it — which also means a mistake
  // arrives as an honest-looking 0, publishes green, and leaves every client unable to refuse
  // a replayed list. This script is the only place that sees what was actually written.
  it.each([
    ["a JSON string, the value that published while reading as 0", "2"],
    ["a float", 2.5],
    ["a negative counter", -1],
    [
      "a counter past the ceiling that guards against a poisoned floor",
      1_000_001,
    ],
    ["a boolean", true],
    ["an explicit null", null],
  ])("refuses %s", (_label, sequence) => {
    const { output, status } = run({ revoked: [], sequence, version: 1 });
    expect(status).toBe(1);
    expect(output).toContain("`sequence` must be a plain integer");
    expect(output).toContain(JSON.stringify(sequence));
  });

  it("accepts a plain integer counter", () => {
    const { status } = run({ revoked: [], sequence: 7, version: 1 });
    expect(status).toBe(0);
  });

  it("accepts a list with no counter, but says it cannot refuse a rollback", () => {
    // Absent has to stay publishable: the document that was live before this feature has no
    // `sequence` at all, and the verify step re-validates whatever Pages is still serving.
    // The counter gate catches an absent one on the way out, because 0 cannot beat live.
    const { output, status } = run({ revoked: [], version: 1 });
    expect(status).toBe(0);
    expect(output).toContain("cannot refuse a replayed");
  });
});

// The other half of the same publish gate: the number it compares. Kept in this file because
// a disagreement between these two scripts is the defect — one refuses what the other would
// silently read as 0.
describe("revocation-sequence", () => {
  it("prints the counter the app reads", () => {
    expect(sequenceOf({ revoked: [], sequence: 7, version: 1 })).toEqual({
      status: 0,
      stdout: "7",
    });
  });

  it("prints 0 for a counter the app would discard, not the value as written", () => {
    // ‼️ THE WHOLE REASON THIS SCRIPT EXISTS (code review HIGH-2). The python it replaced —
    // `d.get("sequence") or 0` — read this as 2, so the gate compared 2, published, and every
    // client read 0. The gate must lose exactly what a client loses.
    expect(sequenceOf({ revoked: [], sequence: "2", version: 1 }).stdout).toBe(
      "0",
    );
  });

  it("prints 0 for an unreadable document instead of failing the publish", () => {
    // An unknown document version is unreadable to the app. Permissive here on purpose: a
    // garbled LIVE file must not block an urgent revocation, and the document being published
    // is the one `validate-revocations.ts` refuses outright.
    expect(sequenceOf({ revoked: [], version: 2 })).toEqual({
      status: 0,
      stdout: "0",
    });
  });

  it("prints the number ALONE, even when the list has an entry to complain about", () => {
    // `$(...)` captures stdout, and `normalizeRevocationList` logs every dropped entry. A
    // warning landing on stdout would make the gate compare a string like "…dropped… 3" —
    // shell numeric comparison then errors out on a list that is perfectly fine.
    expect(
      sequenceOf({
        revoked: [{ id: "", reason: "r", severity: "nope", versions: "*" }],
        sequence: 3,
        version: 1,
      }).stdout,
    ).toBe("3");
  });
});

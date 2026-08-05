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
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const SCRIPT = resolve(ROOT, "scripts/validate-registry-assets.ts");
const TSX = resolve(ROOT, "node_modules/.bin/tsx");
const BASE = "https://sayinel.github.io/baram-plugins/";

const ZIP = Buffer.from("PK pretend this is an archive");
const ZIP_SHA = createHash("sha256").update(ZIP).digest("hex");
/** Different bytes, for the case where the script must not hash the file it was shown. */
const OTHER = Buffer.from("MALICIOUS PAYLOAD");

/**
 * ‼️ THE ASSERTION THIS FILE GOT WRONG FIRST TIME (review MEDIUM-7).
 *
 * It used to assert `not.toContain("::error title=forged::")` plus `toContain("∷error")`,
 * which is strictly weaker than the check `validate-index-script.test.ts` already had:
 * deleting the NEWLINE half of the sanitizer left output like `x\n∷error …`, which
 * satisfies both — half the control gone, test green. Actions only interprets a workflow
 * command at the START of a line, so the property is per-line, and this is the form that
 * says it.
 */
function assertNoWorkflowCommand(output: string): void {
  for (const line of output.split("\n")) {
    expect(line.trimStart()).not.toMatch(/^::/u);
  }
}

/**
 * Build a registry checkout on disk and run the script over it.
 *
 * `archives` names the files that exist under `plugins/`; the index is whatever the caller
 * passes. Keeping the two independent is the whole point — every defect this catches is a
 * disagreement between them.
 */
function build(
  entries: unknown,
  archives: string[] = ["baram-word-count-1.0.0.zip"],
  revoked?: string | unknown[],
): string {
  const dir = mkdtempSync(join(tmpdir(), "baram-registry-"));
  mkdirSync(join(dir, "plugins"));
  for (const name of archives) writeFileSync(join(dir, "plugins", name), ZIP);
  writeFileSync(
    join(dir, "index.json"),
    JSON.stringify({ plugins: entries, updatedAt: "2026-08-02" }),
  );
  // Absent by default, which is what every pre-existing case wants: no acknowledgements,
  // so an orphan still warns. A raw string writes the file verbatim, for the unreadable case.
  if (typeof revoked === "string") {
    writeFileSync(join(dir, "revoked.json"), revoked);
  } else if (revoked !== undefined) {
    writeFileSync(
      join(dir, "revoked.json"),
      JSON.stringify({ revoked, version: 1 }),
    );
  }
  return dir;
}

function exec(args: string[]): { output: string; status: null | number } {
  const result = spawnSync(TSX, [SCRIPT, ...args], { encoding: "utf8" });
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

/** A well-formed `unlisted` withdrawal, so each case can vary one field. */
function revocation(overrides: Record<string, unknown> = {}) {
  return {
    id: "baram-ai-summary",
    reason: "withdrawn",
    severity: "unlisted",
    versions: { lt: "2.0.0" },
    ...overrides,
  };
}

function run(
  entries: unknown,
  archives: string[] = ["baram-word-count-1.0.0.zip"],
): { output: string; status: null | number } {
  return exec([build(entries, archives)]);
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
      "plugins/missing-9.9.9.zip is not a regular file in the registry",
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

  it("does not let one listed id silence a DIFFERENT plugin's withdrawn archive", () => {
    // ‼️ The superseded heuristic used to match a bare `${id}-` prefix, so `baram-word`
    // being listed hid every withdrawn `baram-word-count-*.zip` — silencing exactly the
    // case the warning exists for (review MEDIUM-4). The remainder must look like a
    // version. (The `.sort()` by descending id length that supposedly prevented this was
    // dead code: `.some()` short-circuits, so order never mattered.)
    const { output, status } = run(
      [
        validEntry({
          downloadUrl: `${BASE}plugins/baram-word-1.0.0.zip`,
          id: "baram-word",
        }),
      ],
      ["baram-word-1.0.0.zip", "baram-word-count-pro-2.0.0.zip"],
    );
    expect(status).toBe(0);
    expect(output).toContain("baram-word-count-pro-2.0.0.zip");
    expect(output).toContain("belongs to no listed plugin");
  });

  it("drops the warning to a notice once revoked.json records the withdrawal", () => {
    // ‼️ The warning exists to force a DECISION about an archive nobody has decided about.
    // Once the decision is written down one file over, repeating it every run is the alert
    // fatigue this scan's own superseded rule was built to avoid.
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", "baram-ai-summary-1.0.0.zip"],
        [revocation()],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("baram-ai-summary-1.0.0.zip");
    expect(output).toContain("recorded in");
    expect(output).toContain("1 acknowledged withdrawal(s)");
    // Still SAID, just not as a warning: the archive is reachable and that stays visible.
    expect(output).not.toContain("warning(s)");
    expect(output).not.toContain("no revoked.json entry");
  });

  it("keeps warning when the revocation does not cover the archive's version", () => {
    // ‼️ "The id appears somewhere in the list" is not acknowledgement. An entry bounded
    // `lt: 2.0.0` says nothing about a 3.0.0 archive sitting in the directory, and the
    // whole point of the sandboxed-port bound is that later majors are NOT withdrawn.
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", "baram-ai-summary-3.0.0.zip"],
        [revocation()],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("baram-ai-summary-3.0.0.zip");
    expect(output).toContain("no revoked.json entry");
  });

  it("does not let a revoked id silence a DIFFERENT plugin's withdrawn archive", () => {
    // ‼️ THE HOLLOW VERSION OF THIS TEST USED `baram-word-count-pro-2.0.0.zip`, whose
    // remainder starts with a LETTER — `archiveBelongsTo` rejects it before any of the
    // acknowledgement code runs, so it asserted the OLD predicate and passed while the new
    // path was wide open (code review HIGH-1).
    //
    // `baram-word-2-1.0.0.zip` belongs to `baram-word-2`, and its remainder starts with a
    // digit, so it DOES reach the acknowledgement check. What refuses it is that `2-1.0.0`
    // is not a version — the refusal `versions: "*"` would otherwise skip entirely, because
    // `matchesRange(v, "*")` never parses `v`.
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", "baram-word-2-1.0.0.zip"],
        [revocation({ id: "baram-word", versions: "*" })],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("baram-word-2-1.0.0.zip");
    expect(output).toContain("no revoked.json entry");
  });

  it("keeps warning about a MALICIOUS withdrawal however well recorded it is", () => {
    // ‼️ Deference is for `unlisted` — the one severity the model defines as no danger.
    // "A trusted-tier plugin pulled for cause is still one `curl` away" is this scan's
    // reason to exist, and the first version handed exactly that case the quietest channel
    // (code review MEDIUM-4). Allowlist, not `!== "malicious"`: a denylist would hand the
    // same silence to whatever severity is added next.
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", "baram-stealer-1.0.0.zip"],
        [
          revocation({
            id: "baram-stealer",
            severity: "malicious",
            versions: "*",
          }),
        ],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("revoked as malicious");
    expect(output).toContain("STILL downloadable");
    expect(output).toContain("1 warning(s)");
    expect(output).not.toContain("acknowledged withdrawal");
  });

  it("acknowledges an id the list mentions TWICE rather than calling it ambiguous", () => {
    // `revocationFor`'s own docstring calls double-listing legitimate — `unlisted` because
    // the author went quiet, and later something sharper for one bad range. De-duplicating
    // the claimants is what keeps that from reading as two rival plugins; without it the
    // archive falsely warns, and no test caught the missing `Set` (code review LOW-6).
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", "baram-ai-summary-1.0.0.zip"],
        [revocation(), revocation({ versions: { eq: "0.9.0" } })],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("1 acknowledged withdrawal(s)");
  });

  it("counts a DROPPED entry as a rival claimant, not as an absent one", () => {
    // ‼️ The ambiguity check reads the ids the FILE DECLARES, not the ids that survived
    // parsing (code review MEDIUM-2). A rival with a typo'd severity is dropped by
    // `normalizeRevocationList` — and `logger.warn` is a no-op outside Vite, so nothing
    // says so — which would leave one claimant standing where the file names two.
    //
    // ‼️ `a` is the DROPPED one and `a-1` the survivor, deliberately. The first version of
    // this test had it the other way round and was hollow: the survivor `a` extracts
    // `1-2.0.0` from this filename, which `isSemver` rejects on its own, so the test passed
    // even with the ambiguity set computed from the parsed list. Here the survivor extracts
    // a clean `2.0.0`, so nothing but the declared-ids set stands between it and a notice.
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", "a-1-2.0.0.zip"],
        [
          revocation({ id: "a", severity: "unlist", versions: "*" }),
          revocation({ id: "a-1", versions: "*" }),
        ],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("a-1-2.0.0.zip");
    expect(output).toContain("no revoked.json entry");
  });

  it("cannot be made to forge a workflow annotation through a revoked id", () => {
    // ‼️ `revoked.json` is PR-controlled in the registry's `pull_request_target` workflow,
    // and the notice path echoes the matched id. `label()` was applied but nothing tested
    // it: removing either call forged two `::` lines at column 0 — `::stop-commands::`
    // included — with all tests still green (code review MEDIUM-3).
    //
    // The id must prefix a real filename to be echoed at all, so the payload rides in both.
    const id = "x\n::error title=forged::pwned\n::stop-commands::deadbeef";
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", `${id}-1.0.0.zip`],
        [revocation({ id, versions: "*" })],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("acknowledged withdrawal");
    assertNoWorkflowCommand(output);
  });

  it("cannot be made to forge one through a MALICIOUS withdrawal's warning", () => {
    // ‼️ The forgery test above only reaches the NOTICE path. All nine of the first round's
    // mutations landed there too, so `label()` on the two WARNING branches was unpinned —
    // removing it produced four `::` lines at column 0 with every test still green (code
    // review MEDIUM-2). This is the loud-but-recorded branch.
    const id = "x\n::error title=forged::pwned\n::stop-commands::deadbeef";
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", `${id}-1.0.0.zip`],
        [revocation({ id, severity: "malicious", versions: "*" })],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("revoked as malicious");
    assertNoWorkflowCommand(output);
  });

  it("cannot be made to forge one through the unrecorded-orphan warning", () => {
    // ‼️ And this is the DEFAULT outcome for any orphan — the most-travelled line in the
    // section, and the last one still unpinned. The filename alone carries the payload; no
    // revoked.json is involved.
    const { output, status } = run(
      [validEntry()],
      [
        "baram-word-count-1.0.0.zip",
        "x\n::error title=forged::pwned\n::stop-commands::deadbeef-1.0.0.zip",
      ],
    );
    expect(status).toBe(0);
    expect(output).toContain("no revoked.json entry");
    assertNoWorkflowCommand(output);
  });

  it("keeps warning about an archive whose version only TRIMS to a recorded one", () => {
    // ‼️ `parseVersion` trims and coerces, so `1.0.0 ` parses as 1.0.0 — but
    // `plugins/a-1.0.0 .zip` is a DIFFERENT file at a different URL from `a-1.0.0.zip`, and
    // the entry recorded the latter. Acknowledging it would assert coverage nobody wrote.
    // The leniency is right for the app, which reads a version from a manifest; here it is
    // inferred from a filename (code review LOW-3).
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", "baram-ai-summary-1.0.0 .zip"],
        [revocation({ versions: { eq: "1.0.0" } })],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("no revoked.json entry");
    expect(output).not.toContain("acknowledged withdrawal");
  });

  it("reports the index's real problems even when revoked.json is the document null", () => {
    // ‼️ `null` is a valid one-word JSON document. Reading `.revoked` off it threw an
    // uncaught TypeError BEFORE the errors were printed, so a genuine checksum mismatch came
    // back as a stack trace (code review MEDIUM-1). The verdict must survive the bad file.
    const dir = build([validEntry({ checksum: "b".repeat(64) })]);
    writeFileSync(join(dir, "revoked.json"), "null");
    const { output, status } = exec([dir]);
    expect(status).toBe(1);
    expect(output).toContain("could not read it");
    // The point of the test: the ACTUAL defect still gets reported.
    expect(output).toContain("hashes to");
    expect(output).not.toContain("TypeError");
  });

  it("says so when revoked.json is not a regular file", () => {
    // Absent is quiet — every orphan warns anyway. Present-but-a-link is not: something is
    // there and this script is declining to read it, which the operator has to be told.
    const dir = build(
      [validEntry()],
      ["baram-word-count-1.0.0.zip", "baram-ai-summary-1.0.0.zip"],
    );
    mkdirSync(join(dir, "revoked.json"));
    const { output, status } = exec([dir]);
    expect(status).toBe(0);
    expect(output).toContain("revoked.json is not a regular file");
    expect(output).toContain("no revoked.json entry");
  });

  it("treats an archive two revoked ids both claim as acknowledged by neither", () => {
    // ‼️ `a` and `a-1` both satisfy the prefix rule for `a-1-2.0.0.zip`, and nothing in the
    // name says which plugin it is. Picking one would let whichever sorts first vouch for
    // an archive that may not be its own; an ambiguous key must resolve to nothing.
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", "a-1-2.0.0.zip"],
        [
          revocation({ id: "a", versions: "*" }),
          revocation({ id: "a-1", versions: "*" }),
        ],
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("a-1-2.0.0.zip");
    expect(output).toContain("no revoked.json entry");
  });

  it("falls back to warning, loudly, when revoked.json cannot be read", () => {
    // An unreadable list must never read as "everything is accounted for" — that turns one
    // corrupt file into blanket silence over precisely the archives this scan is for.
    const { output, status } = exec([
      build(
        [validEntry()],
        ["baram-word-count-1.0.0.zip", "baram-ai-summary-1.0.0.zip"],
        "{ not json",
      ),
    ]);
    expect(status).toBe(0);
    expect(output).toContain("revoked.json is present but unreadable");
    expect(output).toContain("no revoked.json entry");
  });

  it("leaves type complaints to validate-index rather than repeating them", () => {
    // The two scripts run together in the same job. One message per defect.
    const { status } = run([{ id: "broken" }]);
    expect(status).toBe(0);
  });

  it("refuses a percent-encoded path the server would decode differently", () => {
    // ‼️ THE BYPASS (security review, HIGH-3), verified against production GitHub Pages:
    // `GET /plugins/x-1.0.0%2ezip` is served as `x-1.0.0.zip`. So an entry could point at a
    // benign file for this script to hash while every user downloaded a different one. The
    // shipped script exited 0 on exactly this input.
    const dir = build([], []);
    writeFileSync(join(dir, "plugins", "baram-evil-1.0.0%2ezip"), ZIP);
    writeFileSync(join(dir, "plugins", "baram-evil-1.0.0.zip"), OTHER);
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify({
        plugins: [
          {
            checksum: ZIP_SHA,
            downloadUrl: `${BASE}plugins/baram-evil-1.0.0%2ezip`,
            id: "baram-evil",
          },
        ],
      }),
    );

    const { output, status } = exec([dir]);
    expect(status).toBe(1);
    expect(output).toContain("decodes differently");
  });

  it("resolves a percent-encoded traversal the same way the server does", () => {
    // ‼️ NOT a bypass, and worth pinning as the reason why. `new URL()` normalises
    // `plugins/%2e%2e/index.json` to `/baram-plugins/index.json` — which is exactly what
    // GitHub Pages serves for that request (verified in production: it returns index.json,
    // 200). Script and server therefore agree, which is the only property that matters
    // here; the old `relative.includes("..")` string check agreed with neither.
    //
    // The entry still fails, on the checksum, because it names a file that is not the
    // archive it claims. What must never happen is a silent pass.
    const { output, status } = run([
      validEntry({ downloadUrl: `${BASE}plugins/%2e%2e/index.json` }),
    ]);
    expect(status).toBe(1);
    expect(output).toContain("index.json hashes to");
    // Reported under the path the SERVER resolves, not the one the entry wrote.
    expect(output).not.toContain("%2e%2e");
  });

  it("refuses a symlink rather than hashing what it points at", () => {
    // `stat`/`readFileSync` follow links, so the script would hash the TARGET while Pages
    // serves the link — a pass over a file it never checked (review MEDIUM-3).
    const dir = build([validEntry()], []);
    writeFileSync(join(dir, "outside.bin"), ZIP);
    symlinkSync(
      "../outside.bin",
      join(dir, "plugins", "baram-word-count-1.0.0.zip"),
    );

    const { output, status } = exec([dir]);
    expect(status).toBe(1);
    expect(output).toContain("is not a regular file");
  });

  it("does not report success over an index it could not check", () => {
    // ‼️ A SILENT PASS (review MEDIUM-1): entries with no usable downloadUrl are left to
    // `validate-index.ts`, and the summary used to read "✓ 0 archive(s) present and
    // matching" — a verdict over nothing. The two scripts run together, but this one must
    // not imply it checked what it skipped.
    const { output, status } = run([{ id: "a" }, { id: "b" }]);
    expect(status).toBe(0);
    expect(output).toContain("2 entry/entries not checkable here");
  });

  it("honours --base-url in either argument order", () => {
    // `plugin-release.yml` passes the positional first and the flag second, so the reverse
    // order was never exercised — and the old parser took the flag's VALUE as the registry
    // root (review LOW-2).
    const dir = build([
      validEntry({
        downloadUrl:
          "https://example.test/reg/plugins/baram-word-count-1.0.0.zip",
      }),
    ]);
    for (const args of [
      [dir, "--base-url", "https://example.test/reg/"],
      ["--base-url", "https://example.test/reg/", dir],
    ]) {
      const { output, status } = exec(args);
      expect(output).toContain("1 archive(s) present and matching");
      expect(status).toBe(0);
    }
  });

  it("refuses --base-url with no value rather than silently using the default", () => {
    const { status } = exec([build([validEntry()]), "--base-url"]);
    expect(status).toBe(1);
  });

  it("cannot be made to forge a workflow annotation through an id", () => {
    // §69 security review (LOW-1). This script echoes ids and runs in Actions, so the
    // document it judges must not be able to write the verdict.
    const { output, status } = run([
      validEntry({
        downloadUrl: `${BASE}plugins/missing.zip`,
        id: "x\n::error title=forged::everything is fine\n::stop-commands::deadbeef",
      }),
    ]);
    expect(status).toBe(1);
    assertNoWorkflowCommand(output);
  });

  it("cannot be made to forge one through the downloadUrl either", () => {
    // ‼️ THE PATH THAT WAS UNSANITISED (review HIGH-1): the path taken from `downloadUrl`
    // was printed raw while the id beside it was labelled, in the very script whose need
    // for a sanitizer is why `gha-label.ts` was extracted. Reproduced as a forged
    // annotation at column 0 against the shipped version.
    //
    // ‼️ WHAT CLOSES IT NOW IS THE URL PARSER, NOT `label()` — worth stating, because a
    // test whose name implies otherwise would mislead the next reader. Rewriting the
    // resolution to go through `new URL()` (for the percent-decoding bug) means a newline
    // never survives into the path at all: WHATWG parsing strips it, so
    // `.../plugins/x\n::error…\n.zip` becomes `plugins/x::error%20title=forged::hi.zip`.
    // `label()` on top is belt-and-braces, and both are asserted together here.
    const { output, status } = run([
      validEntry({
        downloadUrl: `${BASE}plugins/x\n::error title=forged::totally fine\n.zip`,
      }),
    ]);
    expect(status).toBe(1);
    assertNoWorkflowCommand(output);
  });

  it("cannot be made to forge one through a PERCENT-ENCODED newline", () => {
    // ‼️ THE PAYLOAD THAT MAKES `label(relative)` LOAD-BEARING, and the reason the test
    // above is not enough. A literal newline never reaches the path — WHATWG URL parsing
    // strips it — so mutating `label(relative)` away left that test green. `%0A` does not
    // get stripped: it survives parsing, `decodeURIComponent` turns it back into a real
    // newline, and `encodeURI` re-encodes it identically, so the canonical-form check
    // passes it through as a legitimate spelling.
    //
    // Reproduced with `label()` removed: a forged annotation at column 0, inside the
    // refusal message. Found by mutation, after the first version of this test asserted
    // the wrong payload — a guard that matched *a* case rather than *the* case.
    const { output, status } = run([
      validEntry({
        downloadUrl: `${BASE}plugins/x%0A::error title=forged::pwned%0A.zip`,
      }),
    ]);
    expect(status).toBe(1);
    assertNoWorkflowCommand(output);
  });

  it("keeps a multi-line id on one line", () => {
    // ‼️ WHAT THE NEWLINE HALF OF THE SANITIZER ACTUALLY BUYS, pinned separately because it
    // is NOT the injection defence. Substituting `::` alone already makes a workflow
    // command impossible on any line — verified by mutation: deleting the newline replace
    // leaves `assertNoWorkflowCommand` green. What it does buy is that one entry cannot
    // spray a message across the log and bury the lines around it.
    const { output, status } = run([
      validEntry({
        downloadUrl: `${BASE}plugins/missing.zip`,
        id: "line-one\nline-two\nline-three",
      }),
    ]);
    expect(status).toBe(1);
    const complaint = output
      .split("\n")
      .filter((l) => l.includes("line-one") || l.includes("line-three"));
    expect(complaint).toHaveLength(1);
    expect(complaint[0]).toContain("⏎");
  });
});

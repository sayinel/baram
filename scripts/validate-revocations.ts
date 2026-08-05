/**
 * Validates `registry/revoked.json` before it is published (§69).
 *
 * This is the check `version-range.ts` assigns to "the registry CI's job" and which did
 * not exist in either repo. It matters because the app is deliberately FORGIVING in two
 * directions that hide an authoring mistake from the person making it:
 *
 * - a malformed ENTRY is dropped and the rest of the list stands
 * - an unparseable RANGE matches nothing
 *
 * Both are right at runtime — one typo must not disarm the other revocations, nor block
 * every plugin. But they mean a mis-authored entry deploys cleanly, serves a 200, and
 * revokes nothing, with no signal reaching the operator who wrote it. That person is
 * acting on a malware report. This is the one place that can tell them.
 *
 * It uses the SHIPPING validator rather than a second copy of the rules, so a document
 * this accepts is one the app will read the same way.
 *
 * Run: npx tsx scripts/validate-revocations.ts [path]
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  MAXIMUM_REVOCATION_SEQUENCE,
  normalizeRevocationList,
} from "../src/plugins/revocation";
import { matchesRange } from "../src/plugins/version-range";
import { label } from "./gha-label";
import { revocationByteCap } from "./rust-constants";

const path = process.argv[2] ?? "registry/revoked.json";

function fail(message: string): never {
  console.error(`✗ ${path}: ${message}`);
  process.exit(1);
}

// ‼️ The cap is the CLIENT's, read from the Rust that enforces it — see `rust-constants.ts` for
// why it is scraped rather than copied, and why the scrape is a function over text.
let cap: number;
try {
  cap = revocationByteCap(
    readFileSync(
      resolve(import.meta.dirname, "../src-tauri/src/plugin/mod.rs"),
      "utf8",
    ),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
// ‼️ INSIDE A `try` (code review MEDIUM-4). `statSync` sits ABOVE the JSON read, so a missing path
// — a typo in the workflow, or a `live.json` the curl never wrote — produced the node stack trace
// this file explicitly forbids fourteen lines below, undoing a property it had already paid for.
let size: number;
try {
  size = statSync(path).size;
} catch (error) {
  fail(
    `cannot be read — ${error instanceof Error ? error.message : String(error)}`,
  );
}
if (size > cap) {
  fail(
    `${size} bytes exceeds the ${cap} the app will fetch — every client would fail to read this list, so no revocation in it would ever apply`,
  );
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  fail(`not valid JSON — ${String(err)}`);
}

// ‼️ `?.`: the JSON document `null` is a valid one-word file, and reading `.revoked` off it
// threw an uncaught TypeError instead of the refusal below — a stack trace where the
// operator needed a sentence. This script is pointed at a PR-controlled file by the
// registry's `validate.yml`, and `validate-registry-assets.ts` copied the same line.
const declared = (raw as null | { revoked?: unknown })?.revoked;
if (!Array.isArray(declared)) {
  fail("no `revoked` array — the app would ignore this file entirely");
}

const parsed = normalizeRevocationList(raw);
if (parsed === null) {
  fail(
    "the app cannot read this document, so it would keep whatever list it already had",
  );
}

// ‼️ THE COUNTER IS CHECKED AGAINST THE RAW DOCUMENT, NOT AGAINST `parsed` (code review
// HIGH-2). `readSequence` reads anything malformed as 0 on purpose — 0 is the weakest value
// there is, so a garbled field LOSES the rollback comparison instead of winning it. The cost
// of that safe default is that by the time a value reaches `parsed.sequence`, an authoring
// mistake is indistinguishable from an honest 0. `sequence: "2"` validated, published, and
// then read as 0 on every machine: the counter meant to refuse a replayed list never left the
// floor, and no signal reached anyone. Comparing raw against parsed is the whole test — they
// differ if and only if the app had to discard what was written.
const rawSequence = (raw as { sequence?: unknown }).sequence;
if (rawSequence === undefined) {
  console.warn(
    `⚠ ${path}: no \`sequence\` — clients read 0, so this list cannot refuse a replayed ` +
      "older one. Add a counter and raise it on every publish.",
  );
} else if (rawSequence !== parsed.sequence) {
  // ‼️ `label()`, like every other untrusted value this script prints (security review LOW-1).
  // `JSON.stringify` happens to escape `\n` and `\r`, so today no line break reaches the log —
  // but that is an accident of the formatter, not a control this repo declared, and it reopens
  // the moment someone writes `String(rawSequence)`. The registry repo's `validate.yml` points
  // this script at a PR-controlled file.
  fail(
    "`sequence` must be a plain integer from 0 to " +
      `${MAXIMUM_REVOCATION_SEQUENCE}, not ${label(JSON.stringify(rawSequence))} — the app ` +
      "reads anything else as 0, and a list at 0 cannot refuse a rollback.",
  );
}

// The check that earns this script's keep. The app drops a bad entry silently; here,
// one bad entry is a build failure with the offending object printed.
if (parsed.revoked.length !== declared.length) {
  const kept = new Set(parsed.revoked);
  const dropped = declared.filter(
    (entry) => !kept.has(entry as (typeof parsed.revoked)[number]),
  );
  console.error(`✗ ${path}: ${dropped.length} entry/entries would be DROPPED`);
  for (const entry of dropped) {
    console.error(`    ${JSON.stringify(entry)}`);
  }
  console.error(
    "  Each needs: a non-empty `id`, a `reason` string, `severity` of " +
      'malicious|vulnerable|unlisted, and `versions` of "*" or an object of ' +
      "eq/gt/gte/lt/lte string bounds. A semver RANGE STRING is not accepted.",
  );
  process.exit(1);
}

// A range that can never match is not a syntax error, so nothing above catches it — and
// it is the most likely way to publish a revocation that quietly protects nobody.
const inert = parsed.revoked.filter(
  (entry) =>
    typeof entry.versions === "object" &&
    !["0.0.0", "1.0.0", "99.99.99", "0.0.1-rc.1"].some((probe) =>
      matchesRange(probe, entry.versions),
    ),
);
if (inert.length > 0) {
  console.warn(
    `⚠ ${path}: ${inert.length} entry/entries matched none of the probe versions — check the bounds:`,
  );
  for (const entry of inert) {
    // ‼️ `label`, not the raw id (security review, HIGH-2). This line predates the
    // registry's CI and only ever read a first-party file; the new `validate.yml` points
    // it at a PR-controlled `revoked.json`. A newline plus `::error title=…::` in an id
    // wrote a forged annotation on a job that EXITS 0, and `::stop-commands::` silenced
    // every genuine one after it.
    console.warn(`    ${label(entry.id)}: ${JSON.stringify(entry.versions)}`);
  }
}

const bySeverity = parsed.revoked.reduce<Record<string, number>>(
  (acc, entry) => ({
    ...acc,
    [entry.severity]: (acc[entry.severity] ?? 0) + 1,
  }),
  {},
);
console.log(
  `✓ ${path}: ${parsed.revoked.length} entry/entries — ${JSON.stringify(bySeverity)}`,
);

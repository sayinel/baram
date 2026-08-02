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
import { readFileSync } from "node:fs";

import { normalizeRevocationList } from "../src/plugins/revocation";
import { matchesRange } from "../src/plugins/version-range";
import { label } from "./gha-label";

const path = process.argv[2] ?? "registry/revoked.json";

function fail(message: string): never {
  console.error(`✗ ${path}: ${message}`);
  process.exit(1);
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

/**
 * Validates a plugin registry `index.json` before it is published (§69).
 *
 * The sibling of `validate-revocations.ts`, and it exists for the same reason. The app is
 * deliberately FORGIVING about this document in three directions, each of which hides an
 * authoring mistake from the person who made it:
 *
 * - an entry Rust cannot deserialize is DROPPED and the rest of the index stands
 *   (`tolerant_entries` in `src-tauri/src/plugin/mod.rs`)
 * - an entry naming an unknown tier or capability is demoted to legacy — listed, but with
 *   Install disabled (`normalizeIndex` in `src/plugins/registry-client.ts`)
 * - an `engines.baram` that is absent or not `>=X.Y.Z` reads as "no floor", so the version
 *   gate simply stops protecting anyone (`unmetBaramFloor` in `src/plugins/engines.ts`)
 *
 * All three are right at runtime: one contributor's typo must not empty the marketplace for
 * every user, nor block installs the app is perfectly able to perform. But together they
 * mean a mis-authored entry deploys cleanly, serves a 200, and is invisible, un-installable,
 * or unprotected — with no signal reaching the operator. This is the one place that can tell
 * them, which is why every check below names a runtime behaviour rather than a style rule.
 *
 * It uses the SHIPPING validators (`parseBaramFloor`, `VALID_CAPABILITIES`) rather than a
 * second copy of the rules, so a document this accepts is one the app reads the same way.
 *
 * Run: npx tsx scripts/validate-index.ts [path]
 */
import { readFileSync } from "node:fs";

import { parseBaramFloor } from "../src/plugins/engines";
import { VALID_CAPABILITIES } from "../src/plugins/manifest";

const path = process.argv[2] ?? "registry/index.json";

/**
 * The fields `RegistryEntry` has no `#[serde(default)]` for — i.e. the ones whose absence
 * costs the whole entry.
 *
 * Duplicated from Rust, and pinned from the Rust side rather than here: the test
 * `registry_entry_minimal_required_fields_deserializes` builds an entry from exactly this
 * list and fails if the struct grows a field it does not cover. That catches the dangerous
 * direction — the struct getting stricter while this list stays behind, which would let a
 * silently-pruned entry through this gate. The opposite drift only makes this script
 * stricter than the app, which costs a publish, not a user.
 */
const REQUIRED_FIELDS = [
  "id",
  "name",
  "description",
  "version",
  "author",
  "license",
  "downloadUrl",
  "checksum",
  "capabilities",
] as const;

/** The two tiers of §260, as a literal list so an unknown value cannot ship. */
const TRUST_VALUES = ["sandboxed", "trusted"];

const errors: string[] = [];
const warnings: string[] = [];

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

const plugins = (raw as { plugins?: unknown }).plugins;
if (!Array.isArray(plugins)) {
  // Matches the one thing Rust still treats as fatal: a document with no `plugins` array is
  // not a partly-broken index, it is the wrong file.
  fail("no `plugins` array — the app cannot read this as an index at all");
}

const seenIds = new Map<string, number>();

plugins.forEach((value, position) => {
  const entry = (value ?? {}) as Record<string, unknown>;
  // Entries are identified by id where possible and by position otherwise, because an entry
  // whose id is the missing field is exactly the case that needs locating.
  const id = typeof entry.id === "string" && entry.id !== "" ? entry.id : null;
  const where = id ?? `entry #${position + 1}`;

  const missing = REQUIRED_FIELDS.filter((field) => entry[field] === undefined);
  if (missing.length > 0) {
    errors.push(
      `${where}: missing ${missing.join(", ")} — the app DROPS an entry it cannot ` +
        "deserialize, so this plugin would be invisible in the marketplace, not broken in it",
    );
    // Everything below reads fields this entry may not have; one report is enough.
    return;
  }

  if (id !== null) {
    const first = seenIds.get(id);
    if (first !== undefined) {
      errors.push(
        `${id}: duplicate id (entries #${first + 1} and #${position + 1}) — lookups take ` +
          "the first match, so the later entry is dead weight that can never be installed",
      );
    } else {
      seenIds.set(id, position);
    }
  }

  const engines = entry.engines as undefined | { baram?: unknown };
  const declared = engines?.baram;
  if (declared === undefined) {
    errors.push(
      `${where}: no engines.baram — optional to READ (so one omission cannot delete the ` +
        "entry) but required to PUBLISH, because without it the version floor protects nobody",
    );
  } else if (
    typeof declared !== "string" ||
    parseBaramFloor(declared) === null
  ) {
    errors.push(
      `${where}: engines.baram ${JSON.stringify(declared)} must be of the form ">=X.Y.Z" — ` +
        "the app IGNORES a range it cannot parse rather than refusing, so this reads as no floor",
    );
  }

  if (entry.trust === undefined) {
    errors.push(
      `${where}: no trust tier — Phase 5 reads a tier-less entry as legacy and DISABLES ` +
        "Install, so this entry can only be looked at",
    );
  } else if (
    typeof entry.trust !== "string" ||
    !TRUST_VALUES.includes(entry.trust)
  ) {
    errors.push(
      `${where}: unknown trust tier ${JSON.stringify(entry.trust)} — must be one of ` +
        `${TRUST_VALUES.join(", ")}; anything else is demoted to legacy and cannot be installed`,
    );
  }

  const checksum = entry.checksum;
  if (typeof checksum !== "string" || !/^[0-9a-f]{64}$/.test(checksum)) {
    errors.push(
      `${where}: checksum must be 64 lowercase hex characters (sha256), got ` +
        JSON.stringify(checksum),
    );
  } else if (/^0{64}$/.test(checksum)) {
    // A WARNING, not an error: the committed seed carries all zeros on purpose, because it
    // names the NEXT release whose ZIP does not exist yet. On the live index it means an
    // install that will fail its integrity check — worth saying loudly, every time.
    warnings.push(
      `${where}: placeholder all-zero checksum — every install of this entry fails ` +
        "verification until the real sha256 is pasted in",
    );
  }

  const capabilities = entry.capabilities;
  if (!Array.isArray(capabilities)) {
    errors.push(`${where}: capabilities must be an array`);
  } else {
    const unknown = capabilities.filter(
      (cap) => !VALID_CAPABILITIES.includes(cap as never),
    );
    if (unknown.length > 0) {
      // A warning rather than an error, and the direction of doubt is the reason: an index
      // may legitimately be NEWER than the app checking it, which is the state
      // `demotedBecause: "unknown-capability"` exists to describe. Failing the publish would
      // make this repo's build the ceiling on what the registry may advertise.
      warnings.push(
        `${where}: capabilities unknown to this build (${unknown
          .map((cap) => JSON.stringify(cap))
          .join(
            ", ",
          )}) — older apps demote the entry to legacy and strip these badges`,
      );
    }
  }

  const url = entry.downloadUrl;
  if (typeof url !== "string" || !/^https:\/\//.test(url)) {
    warnings.push(
      `${where}: downloadUrl is not https (${JSON.stringify(url)}) — the checksum still ` +
        "guards integrity, but the download itself is interceptable",
    );
  }
});

for (const warning of warnings) console.warn(`⚠ ${path}: ${warning}`);

if (errors.length > 0) {
  console.error(`✗ ${path}: ${errors.length} problem(s)`);
  for (const error of errors) console.error(`    ${error}`);
  process.exit(1);
}

console.log(
  `✓ ${path}: ${plugins.length} entry/entries` +
    (warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""),
);

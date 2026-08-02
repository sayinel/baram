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

const isString = (v: unknown) => typeof v === "string";
const isStringArray = (v: unknown) =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
/**
 * `u64`, not "a number" — the residual instance of the type hole (review round 3).
 *
 * JS has one numeric type and Rust's field is `pub downloads: u64`, so `typeof v ===
 * "number"` was still too loose after the presence-vs-type fix: `1.5`, `-1` and `1e20` all
 * passed here and all make serde drop the entry. `downloads` is the one field a stats
 * pipeline computes rather than an author typing, which is exactly where a rate lands as a
 * float and "unknown" lands as `-1`.
 *
 * The `MAX_SAFE_INTEGER` bound is stricter than `u64` on purpose: past 2^53 a JSON number
 * cannot round-trip through JS at all, so this script could not judge it honestly. Stricter
 * than the app costs a publish, never a user.
 */
const isU64 = (v: unknown) =>
  typeof v === "number" &&
  Number.isInteger(v) &&
  v >= 0 &&
  v <= Number.MAX_SAFE_INTEGER;

/**
 * Every field of Rust's `RegistryEntry`, with the TYPE serde demands.
 *
 * ‼️ TYPE, not merely presence. The first version of this script tested
 * `entry[field] === undefined`, which let `"license": null`, `"version": 123` and
 * `"keywords": "word"` through with exit 0 — and serde drops an entry on a wrong type
 * exactly as hard as on a missing key, so those published and vanished from every
 * marketplace. A gate calibrated on absence cannot see the larger half of what it guards.
 *
 * OPTIONAL fields are here too, for the same reason: they carry `#[serde(default)]`, so
 * omitting them is fine, but giving one the wrong type still kills the entry.
 *
 * Duplicated from Rust, and pinned from the Rust side: the test
 * `registry_entry_minimal_required_fields_deserializes` builds an entry from exactly the
 * required names below and fails if the struct grows a field they do not cover. That
 * catches the dangerous drift (struct stricter than this list). It does NOT check types —
 * the table below is the only thing that does.
 */
const FIELDS: Record<
  string,
  { check: (v: unknown) => boolean; required: boolean; type: string }
> = {
  author: { check: isString, required: true, type: "a string" },
  capabilities: {
    check: isStringArray,
    required: true,
    type: "an array of strings",
  },
  checksum: { check: isString, required: true, type: "a string" },
  description: { check: isString, required: true, type: "a string" },
  downloads: {
    check: isU64,
    required: false,
    type: "a non-negative integer (Rust reads it as u64)",
  },
  downloadUrl: { check: isString, required: true, type: "a string" },
  homepage: { check: isString, required: false, type: "a string" },
  icon: { check: isString, required: false, type: "a string" },
  id: { check: isString, required: true, type: "a string" },
  keywords: {
    check: isStringArray,
    required: false,
    type: "an array of strings",
  },
  license: { check: isString, required: true, type: "a string" },
  name: { check: isString, required: true, type: "a string" },
  repository: { check: isString, required: false, type: "a string" },
  trust: { check: isString, required: false, type: "a string" },
  version: { check: isString, required: true, type: "a string" },
};

/** The two tiers of §260, as a literal list so an unknown value cannot ship. */
const TRUST_VALUES = ["sandboxed", "trusted"];

/**
 * An entry id, made safe to print from a GitHub Actions step.
 *
 * §69 security review (LOW-1) — this script echoes the id it is complaining about, and it
 * runs inside `plugin-release.yml`. Actions parses workflow commands out of step OUTPUT, so
 * an id containing a newline followed by `::error title=…::` writes a forged annotation on
 * the release job, and `::stop-commands::` silences every real one after it. Reproduced
 * against the shipped script before this fix.
 *
 * Nothing worse than log spoofing is reachable — `::set-env::` and `::set-output::` are
 * disabled and `::add-mask::` cannot unmask a secret — but a gate whose whole purpose is to
 * TELL THE OPERATOR something must not let the document being judged write the verdict.
 */
function label(raw: string): string {
  const flattened = raw
    .replaceAll(/[\n\r]/gu, "⏎")
    // The command prefix itself, so no reassembly survives the newline strip.
    .replaceAll("::", "∷");
  return flattened.length > 80 ? `${flattened.slice(0, 80)}…` : flattened;
}

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
  const where = label(id ?? `entry #${position + 1}`);

  // Registered BEFORE the early return below, so a duplicate of an entry that is itself
  // broken is still reported. Otherwise fixing the first error would reveal a second.
  if (id !== null) {
    const first = seenIds.get(id);
    if (first !== undefined) {
      errors.push(
        `${where}: duplicate id (entries #${first + 1} and #${position + 1}) — the app now ` +
          "serves NEITHER, because inserting a copy above a real entry hijacks every " +
          "`find` lookup, including the update path (security review MEDIUM-2)",
      );
    } else {
      seenIds.set(id, position);
    }
  }

  const unreadable = Object.entries(FIELDS).flatMap(([field, spec]) => {
    const value = entry[field];
    if (value === undefined)
      return spec.required ? [`${field} is missing`] : [];
    return spec.check(value) ? [] : [`${field} must be ${spec.type}`];
  });
  if (unreadable.length > 0) {
    errors.push(
      `${where}: ${unreadable.join("; ")} — the app DROPS an entry it cannot deserialize, ` +
        "so this plugin would be invisible in the marketplace, not broken in it",
    );
    // Everything below reads fields this entry may not have in a usable shape.
    return;
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
  } else if (!TRUST_VALUES.includes(entry.trust as string)) {
    // Its type is already guaranteed by FIELDS above; only the VALUE is open here.
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

  // An ERROR, not a warning. The tempting argument for a warning is "the index may be newer
  // than the app checking it" — but that describes neither place this runs. In
  // `plugin-release.yml` the checkout IS the tag being released, i.e. the newest capability
  // list in existence, so a name unknown there is unknown to every shipped app and the entry
  // is demoted for everyone. In `lint:frontend` the seed and the list come from the same
  // tree. `demotedBecause: "unknown-capability"` describes what an OLD app should do at
  // runtime, which is a different question from what may be published.
  const unknownCaps = (entry.capabilities as string[]).filter(
    (cap) => !VALID_CAPABILITIES.includes(cap as never),
  );
  if (unknownCaps.length > 0) {
    errors.push(
      `${where}: capabilities unknown to this build (${unknownCaps
        .map((cap) => JSON.stringify(cap))
        .join(
          ", ",
        )}) — the entry is demoted to legacy and these badges are stripped`,
    );
  }

  const url = entry.downloadUrl as string;
  if (!/^https?:\/\//.test(url)) {
    // A hard refusal, not an interception risk: `validate_http_url` allows only http and
    // https, so `ftp://` or a typo'd scheme is rejected before a request is even made. That
    // is the "listed but un-installable" class this script exists to catch, and conflating
    // it with the http-vs-https warning below hid it.
    errors.push(
      `${where}: downloadUrl scheme is not http(s) (${JSON.stringify(url)}) — the app ` +
        "refuses the request outright, so this entry can never be installed",
    );
  } else if (!/^https:\/\//.test(url)) {
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

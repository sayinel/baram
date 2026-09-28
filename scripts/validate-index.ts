/**
 * Validates a plugin registry `index.json` before it is published (§69).
 *
 * The sibling of `validate-revocations.ts`, and it exists for the same reason. The app is
 * deliberately FORGIVING about this document in five directions, each of which hides an
 * authoring mistake from the person who made it:
 *
 * - an entry Rust cannot deserialize is DROPPED and the rest of the index stands
 *   (`tolerant_entries` in `src-tauri/src/plugin/mod.rs`)
 * - an entry naming an unknown tier or capability is demoted to legacy — listed, but with
 *   Install disabled (`normalizeIndex` in `src/plugins/registry-client.ts`)
 * - an entry naming an unknown `kind` is DROPPED, not demoted — it never appears in any
 *   marketplace at all (`dropUnknownKinds`, same file), which is a HARSHER and less visible
 *   failure than the demotion above, not a milder one
 * - an `engines.baram` that is absent or not `>=X.Y.Z` reads as "no floor", so the version
 *   gate simply stops protecting anyone (`unmetBaramFloor` in `src/plugins/engines.ts`)
 * - a `community.json` entry `applyCommunityRules` finds ineligible is DROPPED outright — the
 *   same harsher failure as an unknown `kind` (`src/plugins/community-registry.ts`)
 *
 * All five are right at runtime: one contributor's typo must not empty the marketplace for
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
import { lstatSync, readFileSync, type Stats } from "node:fs";
import { basename, resolve } from "node:path";

import { parseBaramFloor } from "../src/plugins/engines";
import { isGithubLogin } from "../src/plugins/community-registry";
import {
  MAX_TEXT_FIELD_CHARS,
  UNSAFE_TEXT_CHARS_RE,
} from "../src/themes/theme-manifest";
import { registryPreviewPalettes } from "../src/themes/theme-preview-palette";
import { RESERVED_THEME_IDS } from "../src/types/theme";
import { VALID_CAPABILITIES } from "../src/plugins/manifest";
import { FIRST_PARTY_PREFIX, ID_RE, REPO_NAME_RE } from "./community-submission";
import { label } from "./gha-label";
import { registryByteCap } from "./rust-constants";

const path = process.argv[2] ?? "registry/index.json";

/**
 * Rust's `publisherId`/`repoId` are `u64` (no `arbitrary_precision`), so `583231.0` and
 * `5.55e2` parse to the same JS integer as `583231`/`555` but make serde refuse the WHOLE entry
 * (measured against this crate's pinned `serde`/`serde_json` versions: a scratch probe
 * deserializing `{"publisherId":583231.0}` into a `u64` field returns
 * `Err("invalid type: floating point ... expected u64")`). JS collapses the trailing `.0` or the
 * exponent before this script ever sees a *value*, so only the RAW JSON TEXT can tell them apart
 * — captured here with a `JSON.parse` reviver's Node 24 `context.source` (confirmed present by
 * running `node -e` against this repo's Node before relying on it).
 *
 * Stashed on the holder object under a Symbol, so it rides along with the entry through every
 * later access (`entry[field]`) without becoming an enumerable property `Object.entries`,
 * `JSON.stringify` or a test's `toEqual` would ever see.
 *
 * `downloads` (also `u64`, checked by `isU64` in `FIELDS` below) has the exact same hole — a
 * float-spelled `downloads` reads as a valid non-negative integer here and still makes serde
 * drop the entry — but closing it is NOT a one-liner: `isU64`'s callers are `FIELDS`' generic
 * `check(value)` signature, which has no entry or field-name context to look up a raw source
 * with. Left open, undone.
 */
const RAW_NUMBER_SOURCE = Symbol("raw-number-source");

function reviveWithRawNumberSource(
  this: unknown,
  key: string,
  value: unknown,
  context?: { source?: string },
): unknown {
  if (
    (key === "publisherId" || key === "repoId") &&
    context?.source !== undefined &&
    typeof this === "object" &&
    this !== null
  ) {
    const holder = this as Record<PropertyKey, unknown>;
    const store =
      (holder[RAW_NUMBER_SOURCE] as undefined | Record<string, string>) ?? {};
    store[key] = context.source;
    holder[RAW_NUMBER_SOURCE] = store;
  }
  return value;
}

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
  // §360 — optional to READ (absence means a legacy "plugin" entry), same as `trust`. This
  // table only pins the WIRE TYPE serde demands; the VALUE (`"plugin"` | `"theme"`) is
  // checked below, against `KIND_VALUES`.
  kind: { check: isString, required: false, type: "a string" },
  license: { check: isString, required: true, type: "a string" },
  name: { check: isString, required: true, type: "a string" },
  readme: { check: isString, required: false, type: "a string" },
  repository: { check: isString, required: false, type: "a string" },
  trust: { check: isString, required: false, type: "a string" },
  version: { check: isString, required: true, type: "a string" },
};

/**
 * The two kinds of §360, as a literal list so an unknown value cannot ship.
 *
 * ‼️ MAJOR (fix round 1) — this gate was missing entirely; `kind` had a type check in
 * `FIELDS` above but no value check here, so `kind: "themes"` (a typo) was a valid string,
 * passed CI green, and only failed at the door of every client: `dropUnknownKinds`
 * (`src/plugins/registry-client.ts`) removes the entry with nothing louder than a
 * `logger.warn` nobody reads. The asymmetry with `trust` argues FOR this gate, not against
 * it: an unknown `trust` still leaves the entry listed and visibly un-installable, while an
 * unknown `kind` makes it disappear — the harsher and less visible the runtime failure, the
 * more the publish gate is the only place that can catch it.
 */
const KIND_VALUES = ["plugin", "theme"];

/** The two tiers of §260, as a literal list so an unknown value cannot ship. */
const TRUST_VALUES = ["sandboxed", "trusted"];

const errors: string[] = [];
const warnings: string[] = [];

/**
 * §380/§381 — what community.json may carry beyond the shared rules (spec 0058 §8.3, contract
 * C1). Each rule below is named for the specific runtime consequence of skipping it, measured
 * rule by rule against `src/plugins/community-registry.ts`, `src/plugins/registry-client.ts`
 * and `src-tauri/src/plugin/registry.rs` — no single function owns all of them:
 *
 * - id prefix, kind `"theme"`, a well-typed-but-invalid `publisher`/`publisherId`/`repoId`
 *   (e.g. a login that fails the GitHub grammar, or `0`) — `applyCommunityRules`'s
 *   `ineligibility` DROPS the entry outright (`logger.warn`, nothing louder), so it never
 *   reaches any marketplace at all.
 * - a WRONG-TYPED `publisher`/`publisherId`/`repoId` (a number where a login string is
 *   expected, a string or float where the numeric id is expected) never reaches `ineligibility`
 *   at all — Rust's `CommunityRegistryEntry` (`#[serde(flatten)]` over `RegistryEntry` plus
 *   `Option<String>`/`Option<u64>` fields) fails to deserialize the WHOLE entry, and
 *   `tolerant_entries` drops it before any JSON reaches the frontend (pinned by
 *   `a_wrong_typed_field_drops_a_community_entry` in `registry.rs`).
 * - a `kind` present but not `"plugin"` OR `"theme"` (a typo, not `"theme"` itself) is dropped
 *   earlier still, by `dropUnknownKinds` inside the SHARED `normalizeIndex` both files run
 *   through before `applyCommunityRules` ever sees the entry (`registry-client.ts`) — the same
 *   drop the unknown-`kind` check BELOW guards for `index.json` (it runs for both files, later
 *   in the same entry's checks).
 * - trust — NOT `applyCommunityRules`'s job for a value it does not recognize; an unrecognized
 *   tier is `normalizeIndex`'s job (shared with index.json, demoting to legacy), and is already
 *   caught by the generic "unknown trust tier" check BELOW, later in this same entry's checks.
 *   What `applyCommunityRules` itself demotes is the one legal-but-disallowed value:
 *   `"trusted"` is downgraded to legacy with `demotedBecause: "community-trusted"`, because
 *   community plugins are sandboxed only until the trusted stage (spec 0058 §378).
 * - id charset — read by NEITHER app function; the PRIMARY reason to refuse it is spec 0058
 *   §7.2 gate 2 itself (the submission gate refuses any id outside `/^[a-z0-9][a-z0-9-]*$/`, so
 *   no honestly-submitted entry has one). ‼️ Not an install argument in general — the app's own
 *   id gates (`src/plugins/manifest.ts`'s `validateManifest`, `src-tauri/src/plugin/mod.rs`'s
 *   manifest loader) accept the LOOSER `/^[a-z0-9-]+$/`, unanchored at the first character, so
 *   e.g. `-foo` is installable even though gate 2 refuses it. The install argument holds only
 *   for a character truly outside `[a-z0-9-]` (uppercase, unicode, etc.): no manifest can ever
 *   spell one, and `src-tauri/src/plugin/install.rs`'s `commit_staged_plugin_install` refuses
 *   the install when `manifest.id() != expected_id` (byte-for-byte), so such a registry id can
 *   never match.
 * - repository shape — read by NEITHER app function. `PluginDetail.tsx` renders it only as the
 *   `href` of a FIXED-label link (`safeLinkHref` gates the scheme; the visible text is a static
 *   i18n string, not the URL), so a bad value is a display/provenance defect, not a drop.
 */
function checkCommunityEntry(entry: Record<string, unknown>, where: string): void {
  if ((entry.id as string).startsWith(FIRST_PARTY_PREFIX)) {
    errors.push(`${where}: community ids may not start with "${FIRST_PARTY_PREFIX}" — the prefix is the first-party channel's`);
  } else if (!ID_RE.test(entry.id as string)) {
    const uninstallable = !/^[a-z0-9-]+$/u.test(entry.id as string);
    errors.push(
      `${where}: id must match ${ID_RE} — spec 0058 §7.2 gate 2's own rule for a submitted id, ` +
        "so no honestly-submitted entry has one outside it" +
        (uninstallable
          ? "; it also cannot be installed, since neither the manifest loader (manifest.ts) " +
            "nor install.rs's byte-for-byte id comparison can ever match a character outside " +
            "[a-z0-9-]"
          : ""),
    );
  }
  if (entry.kind !== undefined && entry.kind !== "plugin") {
    errors.push(`${where}: kind ${JSON.stringify(entry.kind)} — community.json carries plugins only; the app drops anything else from it`);
  }
  if (entry.trust !== "sandboxed") {
    errors.push(`${where}: trust must be "sandboxed" — community plugins are sandboxed only until the trusted stage (spec 0058 §378), and the app demotes a "trusted" entry to legacy`);
  }
  if (!isGithubLogin(entry.publisher)) {
    errors.push(`${where}: publisher must be a GitHub login — the app drops a community entry without one`);
  }
  for (const field of ["publisherId", "repoId"]) {
    const value = entry[field];
    if (!(typeof value === "number" && Number.isSafeInteger(value) && value > 0)) {
      errors.push(`${where}: ${field} must be a positive integer — identity is compared by this number, never by login`);
      continue;
    }
    // The value reads fine to JS; only the raw JSON text can show a float or exponent
    // spelling Rust's u64 deserializer refuses (see RAW_NUMBER_SOURCE above).
    const rawSource = (
      (entry as Record<PropertyKey, unknown>)[
        RAW_NUMBER_SOURCE
      ] as undefined | Record<string, string>
    )?.[field];
    if (rawSource !== undefined && !/^[1-9]\d*$/u.test(rawSource)) {
      errors.push(
        `${where}: ${field} is written as ${rawSource} — Rust's u64 deserializer refuses ` +
          "any decimal point or exponent outright, dropping the entire entry, even though " +
          `JavaScript reads it as the plain integer ${value}`,
      );
    }
  }
  // Gate 2's repo-name charset (`REPO_NAME_RE`), not a bare `[^/]+`: that admitted `?`, `#`
  // and a literal newline into the name segment, all silently swallowed by a wildcard that
  // excluded only `/`.
  const repository = entry.repository;
  const repoMatch =
    typeof repository === "string"
      ? /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/u.exec(repository)
      : null;
  if (
    repoMatch === null ||
    typeof entry.publisher !== "string" ||
    repoMatch[1] !== entry.publisher ||
    !REPO_NAME_RE.test(repoMatch[2]) ||
    repoMatch[2] === "." ||
    repoMatch[2] === ".."
  ) {
    errors.push(`${where}: repository must be https://github.com/<publisher>/<name>`);
  }
}

function fail(message: string): never {
  console.error(`✗ ${path}: ${message}`);
  process.exit(1);
}

// ‼️ The cap is the CLIENT's, read from the Rust that enforces it — see `rust-constants.ts`.
// This document is PR-controlled in the registry's `validate.yml` (`pull_request_target`), so
// it is read only after it is confirmed to be a regular file — not a symlink, whose reported
// size describes the LINK, not whatever it points at (a FIFO or an unbounded stream would
// hang or grow this script's read without bound) — and after that size is known to be one a
// client would accept.
let cap: number;
try {
  cap = registryByteCap(
    readFileSync(
      resolve(import.meta.dirname, "../src-tauri/src/plugin/fetch.rs"),
      "utf8",
    ),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
let stat: Stats;
try {
  stat = lstatSync(path);
} catch (error) {
  fail(
    `cannot be read — ${error instanceof Error ? error.message : String(error)}`,
  );
}
if (!stat.isFile()) {
  fail(
    `${path} is not a regular file — a symlink's reported size describes the link, not ` +
      "whatever it points at, so it cannot be trusted before this script reads the target",
  );
}
if (stat.size > cap) {
  fail(
    `${stat.size} bytes exceeds the ${cap} bytes the app will fetch — every client would fail to read this index, so nothing in it would ever be listed`,
  );
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path, "utf8"), reviveWithRawNumberSource);
} catch (err) {
  fail(`not valid JSON — ${String(err)}`);
}

// §381 — which channel this document is (spec 0058 §8.3, §9.1). The app decides the channel by
// the FILE it fetched, so a file whose name and key disagree is refused rather than judged by
// either set of rules.
const doc = (raw ?? {}) as { communityPlugins?: unknown; plugins?: unknown };
if (doc.plugins !== undefined && doc.communityPlugins !== undefined) {
  fail("carries both `plugins` and `communityPlugins` — one file is one channel (spec 0058 §9.1)");
}
const community = doc.communityPlugins !== undefined;
const fileName = basename(path);
if (fileName === "community.json" && !community) {
  fail(
    "community.json must hold `communityPlugins`, never `plugins` — every shipped RegistryIndex " +
      "parser reads `plugins`, and this file must stay unreadable to them (spec 0058 G7)",
  );
}
if (fileName === "index.json" && community) {
  fail("index.json must hold `plugins` — `communityPlugins` belongs in community.json (spec 0058 §8.3)");
}
const plugins = community ? doc.communityPlugins : doc.plugins;
if (!Array.isArray(plugins)) {
  // Matches ONE of the two things Rust's `tolerant_entries` still treats as fatal: a document
  // with no entry array is not a partly-broken index, it is the wrong file. (The other is every
  // entry in a non-empty array failing to deserialize — `RawRegistryIndex`/
  // `RawCommunityRegistryIndex` require the array itself, and `tolerant_entries` separately
  // refuses a non-empty array with zero survivors; this script cannot reproduce that second
  // case without re-implementing per-entry deserialization, so it is out of scope here.)
  fail(
    community
      ? "`communityPlugins` is not an array — the app cannot read this file"
      : "no `plugins` array — the app cannot read this as an index at all",
  );
}

const seenIds = new Map<string, number>();

plugins.forEach((value, position) => {
  const entry = (value ?? {}) as Record<string, unknown>;
  // Entries are identified by id where possible and by position otherwise, because an entry
  // whose id is the missing field is exactly the case that needs locating.
  const id = typeof entry.id === "string" && entry.id !== "" ? entry.id : null;
  const named = label(id ?? `entry #${position + 1}`);
  // §381 — `validate-registry-assets.ts` runs over community.json too (spec 0058 §8.2 step 4),
  // and `plugin-release.yml` runs it before every first-party push, so a broken community entry
  // must name its own file rather than reading as an anonymous failure in that log. Named by
  // the FILE actually read (`fileName`), not a hardcoded "community.json" — this document is
  // whichever file `community` was computed from above.
  const where = community ? `${named} (${fileName})` : named;

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

  // §360 / 0090 final review (L1) — `trust` is a PLUGIN field, and demanding it of a theme
  // told the operator something false. The theme install path never reads `trust`
  // (`themes/theme-install.ts`), so a tier-less theme entry is not "legacy with Install
  // disabled" — it is an ordinary theme entry. The plan's own out-of-code precondition is
  // publishing one theme, so this gate met that operator on their first attempt with a
  // reason that did not apply.
  //
  // `capabilities` stays required for BOTH kinds, a few lines up in `FIELDS`, and for a
  // reason that has nothing to do with capabilities: Rust's `RegistryEntry`
  // (`src-tauri/src/plugin/registry.rs`) has no serde default for it, so an entry without
  // it fails deserialization and is dropped at fetch with only a `droppedCount` warning.
  // That is a WIRE-SHAPE requirement; a theme publishes `"capabilities": []`.
  const isTheme = entry.kind === "theme";

  // §380/§381 — the per-file rules. The FILE is the channel: first-party plugin ids carry the
  // prefix that community.json refuses, so the two lists can never name the same plugin.
  if (community) {
    checkCommunityEntry(entry, where);
  } else if (!isTheme && !(entry.id as string).startsWith(FIRST_PARTY_PREFIX)) {
    errors.push(
      `${where}: a first-party plugin id starts with "${FIRST_PARTY_PREFIX}" — the reserved prefix is spec 0058 §7.2 gate 2, restated per-file in §8.3`,
    );
  }

  if (isTheme && entry.trust !== undefined) {
    // Not an error: an entry is readable either way. But a tier on a theme is a field
    // nothing reads, and saying so is how it stops being copied into the next one.
    warnings.push(
      `${where}: trust tier ${JSON.stringify(entry.trust)} on a kind:"theme" entry — the ` +
        "theme install path never reads it; it is a plugin field",
    );
  }
  if (isTheme) {
    // M2 — an id a built-in theme already owns can be installed and then never applied:
    // `findThemeById` resolves it to the shipped theme. `installTheme` refuses it too; this
    // is the copy that reaches the operator before any user sees it.
    if (RESERVED_THEME_IDS.has(entry.id as string)) {
      errors.push(
        `${where}: id ${JSON.stringify(entry.id)} is one a built-in theme already uses ` +
          '(or the reserved "system") — the app resolves that id to the shipped theme, so ' +
          "this entry could be installed and then never applied",
      );
    }
  } else if (entry.trust === undefined) {
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

  // §360 — unlike `trust` above, ABSENCE is not an error here: every index published
  // before today has no `kind` at all, and the app reads that as a legacy "plugin" entry
  // on purpose (`RegistryEntry.kind`'s doc comment). Only a PRESENT-but-unrecognized value
  // is checked — and it is checked precisely BECAUSE the runtime failure is harsher than
  // trust's: `dropUnknownKinds` removes the entry outright, with nothing louder than a
  // `logger.warn` nobody reads, so this gate is the only place an author's typo surfaces.
  if (entry.kind !== undefined && !KIND_VALUES.includes(entry.kind as string)) {
    // Its type is already guaranteed by FIELDS above; only the VALUE is open here.
    errors.push(
      `${where}: unknown kind ${JSON.stringify(entry.kind)} — must be one of ` +
        `${KIND_VALUES.join(", ")}; anything else is DROPPED from the index entirely and ` +
        "never appears in any marketplace (not merely demoted, the way an unknown trust tier is)",
    );
  }

  // 0090 final review (L5) — the `name` a consent dialog renders, checked where it is
  // published.
  //
  // ‼️ THE MANIFEST'S NAME IS ALREADY CHECKED AND THIS ONE WAS NOT. Both theme and plugin
  // consent dialogs show the REGISTRY entry's name (`ThemeBrowser.tsx` passes
  // `pendingConsent.entry.name`), which until now had to be a string and nothing else —
  // `theme-manifest.ts`'s length and control/bidi rules apply to the downloaded manifest,
  // i.e. to the name the card shows AFTERWARDS. Two rounds went into isolating that dialog
  // from a hostile theme's CSS; leaving the string inside it unbounded gives back part of
  // what that bought, because a bidi override or a 4,000-character name deceives without
  // needing any CSS at all.
  //
  // ‼️ The limit and the character class are IMPORTED from `src/themes/theme-manifest.ts`,
  // not restated. The two layers check the same field for the same reason, and a second
  // literal here is the shape that drifts. Applies to BOTH kinds — `PluginConsentDialog`
  // renders the entry's name too.
  const name = entry.name;
  if (typeof name === "string") {
    if (name.trim() === "" || name.length > MAX_TEXT_FIELD_CHARS) {
      errors.push(
        `${where}: name must be 1-${MAX_TEXT_FIELD_CHARS} characters (got ${name.length}) — ` +
          "it is rendered verbatim in the install consent dialog",
      );
    }
    if (UNSAFE_TEXT_CHARS_RE.test(name)) {
      errors.push(
        `${where}: name contains a control or bidi-override character — those reorder or ` +
          "hide text in the install consent dialog, which is the one screen that must read " +
          "as written",
      );
    }
  }

  // §380 gate 8 — the other two strings the card and the consent dialog render. Only the
  // character class, as spec 0058 §7.2 asks: a description is legitimately longer than a name.
  for (const field of ["author", "description"]) {
    const value = entry[field];
    if (typeof value === "string" && UNSAFE_TEXT_CHARS_RE.test(value)) {
      errors.push(
        `${where}: ${field} contains a control or bidi-override character — those reorder or hide text on the screens that render it`,
      );
    }
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

  // §69 — the same scheme rule for `readme`, and it fails HARDER than the download's.
  //
  // ‼️ NOTHING ATTESTS A README. The archive has a checksum beside it, so a non-https
  // download is degraded rather than forged; this document has no such backstop, and it is
  // rendered as markdown on the one screen a user reads to decide whether to grant full
  // trust. So a non-https readme is an error here, not a warning.
  //
  // WHAT THIS DOES NOT CHECK: that the URL is under the registry's own base. That check
  // needs the index URL, which this script is not given — it validates a document, not a
  // deployment. `fetch_registry_readme` enforces it at the moment of dereference, where the
  // index URL is known, and re-checks every redirect hop. Stated because a scheme check
  // that looked like an origin check would be worse than none.
  // 스펙 0063 §5.1 · §5.3 — the preview is judged by the app's OWN filter, the one
  // `registry-client.ts` runs before caching the index. Both refusals below are silent at
  // runtime: the app drops the preview (never the entry) and the browse card draws no colours.
  if (entry.preview !== undefined) {
    if (!isTheme) {
      errors.push(
        `${where}: preview on a non-theme entry — the app drops it (only kind:"theme" entries carry one)`,
      );
    } else if (registryPreviewPalettes(entry.preview) === undefined) {
      errors.push(
        `${where}: preview does not match the contract (light/dark only, each exactly the 16 ` +
          "PREVIEW_COLOR_KEYS as opaque hex) — the app drops the whole preview and the browse " +
          "card draws no colours",
      );
    }
  } else if (isTheme) {
    warnings.push(
      `${where}: no preview — the theme browser draws this card without colours`,
    );
  }

  if (entry.readme !== undefined) {
    const readme = entry.readme as string;
    if (!/^https:\/\//.test(readme)) {
      errors.push(
        `${where}: readme must be an https URL (${JSON.stringify(readme)}) — it is ` +
          "rendered as markdown before install and nothing attests its contents",
      );
    }
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

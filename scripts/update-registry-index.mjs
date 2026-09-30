#!/usr/bin/env node
/**
 * Upsert a plugin entry into a registry index.json OR community.json (§381 — community mode is
 * the four `--publisher`/`--publisher-id`/`--repo-id`/`--repository` flags below).
 * Called by .github/workflows/plugin-release.yml (§69 registry hosting) and the community
 * publish job (plan 0105 Task 10, spec 0058 §8.2 step 3).
 *
 * Usage:
 *   node scripts/update-registry-index.mjs \
 *     --index path/to/index.json \
 *     --manifest examples/plugins/word-count/baram-plugin.json \
 *     --zip-name baram-word-count-1.0.0.zip \
 *     --checksum <64-hex sha256> \
 *     --base-url https://sayinel.github.io/baram-plugins/ \
 *     [--publisher <login> --publisher-id <n> --repo-id <n> --repository <url>]
 *
 * §371 6b-2 — theme mode (spec 0063 §7.4): `--kind theme --preview <file>`, with the theme's
 * packaged `baram-theme.json` as `--manifest` and the palettes `run-theme-package.ts verify`
 * extracted from the same archive as `--preview`.
 */
import { readFileSync, writeFileSync } from "node:fs";

function fail(msg) {
  console.error(`update-registry-index: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail(`bad argument pair: ${key ?? ""} ${value ?? ""}`);
    }
    args[key.slice(2)] = value;
  }
  for (const required of [
    "index",
    "manifest",
    "zip-name",
    "checksum",
    "base-url",
  ]) {
    if (!args[required]) fail(`missing --${required}`);
  }
  return args;
}

const MANIFEST_REQUIRED = [
  "id",
  "name",
  "description",
  "version",
  "author",
  "license",
  "capabilities",
  // §260 Phase 6 — REQUIRED, and a release fails without it. `trust` was missing from
  // this list until Phase 6, so every published entry lacked it; Phase 5 reads a
  // `trust`-less entry as legacy and disables Install, which made the whole live
  // registry un-installable. A manifest without `trust` is already invalid for the
  // loader (`validateManifest`), so an index entry without one can only describe a
  // plugin nobody can install — failing here is the only outcome that tells anyone.
  "trust",
  "engines",
];

/** The two tiers of §260. Kept as a literal list so an unknown value cannot ship. */
const TRUST_VALUES = ["sandboxed", "trusted"];

/**
 * §371 6b-2 — what a THEME entry is written from (spec 0063 §7.4). A theme manifest
 * (`baram-theme.json`) has no `capabilities` and no `trust`: the entry carries
 * `"capabilities": []` for the wire shape Rust's `RegistryEntry` needs and no tier at all,
 * which is what `validate-index.ts` expects of `kind: "theme"`.
 */
const THEME_MANIFEST_REQUIRED = [
  "id",
  "name",
  "description",
  "version",
  "author",
  "license",
  "engines",
];
const KIND_VALUES = ["plugin", "theme"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

const args = parseArgs(process.argv.slice(2));

if (!/^[0-9a-f]{64}$/.test(args.checksum)) {
  fail("checksum must be 64 lowercase hex chars");
}

if (!/^[a-z0-9][a-z0-9.-]*\.zip$/.test(args["zip-name"])) {
  fail("--zip-name must match /^[a-z0-9][a-z0-9.-]*\\.zip$/");
}

// §69 — OPTIONAL, and shaped like the zip name for the same reason: this string is pasted
// into a URL, so anything that could leave the `readme/` directory (a `/`, a `..`, a `%2f`)
// must not survive the pattern. The charset admits neither, `.` only between name
// characters.
if (
  args["readme-name"] !== undefined &&
  !/^[a-z0-9][a-z0-9.-]*\.md$/.test(args["readme-name"])
) {
  fail("--readme-name must match /^[a-z0-9][a-z0-9.-]*\\.md$/");
}

const kind = args.kind ?? "plugin";
if (!KIND_VALUES.includes(kind)) {
  fail(`--kind must be one of ${KIND_VALUES.join(", ")} (got ${JSON.stringify(kind)})`);
}
const theme = kind === "theme";
if (theme && args.preview === undefined) {
  fail("theme mode needs --preview — the palettes run-theme-package.ts verify extracted");
}
if (!theme && args.preview !== undefined) {
  fail("--preview is a theme field (spec 0063 §5.1); the app drops it from a plugin entry");
}
if (theme && args["readme-name"] !== undefined) {
  fail("--readme-name is not published for a theme — the theme archive carries no README");
}

const manifest = JSON.parse(readFileSync(args.manifest, "utf8"));
for (const field of theme ? THEME_MANIFEST_REQUIRED : MANIFEST_REQUIRED) {
  if (manifest[field] === undefined)
    fail(`manifest missing required field: ${field}`);
}
if (theme) {
  for (const field of ["capabilities", "trust"]) {
    if (manifest[field] !== undefined) {
      fail(`a theme manifest carries no '${field}' — that is a plugin field`);
    }
  }
}

if (
  !isNonEmptyString(manifest.id) ||
  !/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)
) {
  fail(
    "manifest field 'id' must be a non-empty string matching /^[a-z0-9][a-z0-9-]*$/",
  );
}
for (const field of ["name", "description", "author", "license"]) {
  if (!isNonEmptyString(manifest[field])) {
    fail(`manifest field '${field}' must be a non-empty string`);
  }
}
if (
  !isNonEmptyString(manifest.version) ||
  !/^\d+\.\d+\.\d+$/.test(manifest.version)
) {
  fail(
    "manifest field 'version' must be a string matching /^\\d+\\.\\d+\\.\\d+$/",
  );
}
if (
  !theme &&
  (!Array.isArray(manifest.capabilities) ||
    !manifest.capabilities.every(isNonEmptyString))
) {
  fail("manifest field 'capabilities' must be an array of non-empty strings");
}
if (!theme && !TRUST_VALUES.includes(manifest.trust)) {
  fail(
    `manifest field 'trust' must be one of ${TRUST_VALUES.map((t) => `"${t}"`).join(", ")}` +
      ` (got ${JSON.stringify(manifest.trust)})`,
  );
}
if (
  typeof manifest.engines !== "object" ||
  manifest.engines === null ||
  Array.isArray(manifest.engines) ||
  !Object.values(manifest.engines).every(isNonEmptyString)
) {
  fail(
    "manifest field 'engines' must be a plain object whose values are non-empty strings",
  );
}
if (manifest.icon !== undefined && !isNonEmptyString(manifest.icon)) {
  fail("manifest field 'icon' must be a non-empty string when present");
}
if (
  manifest.keywords !== undefined &&
  (!Array.isArray(manifest.keywords) ||
    !manifest.keywords.every(isNonEmptyString))
) {
  fail(
    "manifest field 'keywords' must be an array of non-empty strings when present",
  );
}

// §371 6b-2 — the preview's SHAPE is checked here only as far as plain Node can without a copy
// of the key list: an object of `light`/`dark`, each an object of strings. The contract itself —
// exactly `PREVIEW_COLOR_KEYS`, opaque hex values — is `registryPreviewPalettes`, TypeScript, and
// it runs twice before a push: in `verifyThemeArchive`, which produced this file, and in
// `validate-index.ts`, which the workflow runs over the whole index right after this script.
let preview;
if (theme) {
  try {
    preview = JSON.parse(readFileSync(args.preview, "utf8"));
  } catch {
    fail(`--preview ${args.preview} is not readable JSON`);
  }
  const isPlainObject = (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value);
  const modes = isPlainObject(preview) ? Object.keys(preview) : [];
  if (
    modes.length === 0 ||
    !modes.every(
      (mode) =>
        (mode === "light" || mode === "dark") &&
        isPlainObject(preview[mode]) &&
        Object.values(preview[mode]).every(isNonEmptyString),
    )
  ) {
    fail("--preview must be an object of light/dark palettes, each an object of colour strings");
  }
}

// Copied, not imported: this is plain Node, and the canonical copies are
// TypeScript. `GITHUB_LOGIN` mirrors `src/plugins/community-registry.ts`'s (same name there);
// `registry-index-script.test.ts`'s "agrees with isGithubLogin" boundary corpus is what pins
// the two together (it drives this script's `--publisher` across the same corpus and compares
// against the TS predicate directly). `REPO_NAME_RE` mirrors the exported
// `scripts/community-submission.ts` constant of the same name — that module is TypeScript too,
// so it is copied rather than imported, same as `GITHUB_LOGIN`.
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

// §381 — community mode (spec 0058 §8.2 step 3). The four flags come from GitHub's numbers
// (publish-community.yml), never from the author's descriptor. All four or none: a
// half-community entry is one the app drops.
const COMMUNITY_ARGS = ["publisher", "publisher-id", "repo-id", "repository"];
const communityGiven = COMMUNITY_ARGS.filter((key) => args[key] !== undefined);
const community = communityGiven.length > 0;
if (community && theme) {
  fail("community.json carries plugins only (spec 0063 §11) — a theme is not published there");
}
if (community && communityGiven.length !== COMMUNITY_ARGS.length) {
  fail(`community mode needs all of ${COMMUNITY_ARGS.map((key) => `--${key}`).join(", ")}`);
}
if (community) {
  if (manifest.trust !== "sandboxed") fail("a community entry must be sandboxed (spec 0058 §378)");
  if (manifest.id.startsWith("baram-")) fail('ids starting with "baram-" are reserved for first-party plugins');
  for (const key of ["publisher-id", "repo-id"]) {
    if (!/^[1-9]\d{0,15}$/.test(args[key]) || !Number.isSafeInteger(Number(args[key]))) {
      fail(`--${key} must be a positive integer`);
    }
  }
  if (!GITHUB_LOGIN.test(args.publisher)) fail("--publisher must be a GitHub login");
  // Gate 2's repo-name charset, not a bare `[^/]+`: that wildcard admitted `?`, `#` and a
  // literal newline into the name segment, and never checked the owner against `--publisher`.
  const repoMatch = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(args.repository);
  if (
    repoMatch === null ||
    repoMatch[1] !== args.publisher ||
    !REPO_NAME_RE.test(repoMatch[2]) ||
    repoMatch[2] === "." ||
    repoMatch[2] === ".."
  ) {
    fail("--repository must be https://github.com/<publisher>/<name>");
  }
  if (manifest.homepage !== undefined && !isNonEmptyString(manifest.homepage)) {
    fail("manifest field 'homepage' must be a non-empty string when present");
  }
}

const baseUrl = args["base-url"].endsWith("/")
  ? args["base-url"]
  : `${args["base-url"]}/`;

const entry = {
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  version: manifest.version,
  author: manifest.author,
  license: manifest.license,
  downloadUrl: `${baseUrl}plugins/${args["zip-name"]}`,
  checksum: args.checksum,
  capabilities: theme ? [] : manifest.capabilities,
  // §260 Phase 5 collects consent as (trust, capabilities) against the REGISTRY entry and
  // then refuses to persist a download that exceeds it, so both halves must be here: an
  // entry carrying capabilities but no trust is exactly the legacy shape Install refuses.
  // A theme carries no tier (spec 0063 §7.4) — the theme install path never reads one.
  ...(theme ? {} : { trust: manifest.trust }),
  engines: manifest.engines,
};
if (theme) {
  entry.kind = "theme";
  entry.preview = preview;
}
if (manifest.icon !== undefined) entry.icon = manifest.icon;
if (manifest.keywords !== undefined) entry.keywords = manifest.keywords;
// §69 — where the README published beside this archive can be read before an install.
//
// ‼️ OMITTED, NOT EMPTIED, when the archive had none. An entry carrying `"readme": ""`
// would make every consumer test truthiness on a field the schema says is a URL, and the
// app would try to dereference it once someone forgot.
if (args["readme-name"] !== undefined) {
  entry.readme = `${baseUrl}readme/${args["readme-name"]}`;
}
// §381 — who published it (spec 0058 C1), and `homepage`, one of the five display fields a
// person re-reviews when it changes (spec 0058 §7.3). First-party entries never carried it, and
// still do not: plugin-release.yml's output stays byte-for-byte what it was.
if (community) {
  if (manifest.homepage !== undefined) entry.homepage = manifest.homepage;
  entry.publisher = args.publisher;
  entry.publisherId = Number(args["publisher-id"]);
  entry.repoId = Number(args["repo-id"]);
  entry.repository = args.repository;
}

const index = JSON.parse(readFileSync(args.index, "utf8"));
const key = community ? "communityPlugins" : "plugins";
const other = community ? "plugins" : "communityPlugins";
if (!Array.isArray(index[key])) fail(`${args.index} has no ${key} array`);
if (index[other] !== undefined) {
  fail(`${args.index} carries ${other} — this entry belongs in the other file (spec 0058 §8.3)`);
}

// ‼️ REFUSE AN AMBIGUOUS ID RATHER THAN UPDATING THE FIRST ONE.
//
// `findIndex` is first-match-wins, so an index already holding two entries for this id
// would have this release written into whichever copy sits higher — and an attacker who
// can only APPEND cannot control that, but one who can insert can. The genuine entry would
// then be left behind at its old version, and the app's `dropAmbiguousIds` serves NEITHER,
// so the plugin silently disappears from every marketplace.
//
// `validate-index.ts` runs after this and rejects duplicates, so the push was already
// blocked — but only because of step ORDER, which is exactly the kind of guarantee that
// evaporates in a refactor. Stating it here makes the upsert itself unambiguous.
const matches = index[key].filter((p) => p.id === entry.id).length;
if (matches > 1) {
  fail(
    `${key} already holds ${matches} entries for ${entry.id} — refusing to guess ` +
      "which one this release replaces (the app serves neither, see dropAmbiguousIds)",
  );
}

const at = index[key].findIndex((p) => p.id === entry.id);
// §371 6b-2 — plugins and themes share this array and this id space, so an upsert matched by id
// alone would let a theme release overwrite a plugin of the same id (or the reverse), and every
// installed copy would then be offered an "update" of the other kind.
if (at >= 0 && (index[key][at].kind ?? "plugin") !== kind) {
  fail(
    `${entry.id} is listed as kind ${JSON.stringify(index[key][at].kind ?? "plugin")}; ` +
      `a ${kind} release does not replace it`,
  );
}
// An automated upsert must not change an existing entry's identity. Spec 0058 §8.5:
// ownership transfer or an account deletion is fixed by a
// manual maintenance commit that edits `publisherId`/`repoId` directly, never by this script
// running unattended in the publish reconcile. Community-only: a first-party entry carries
// neither field, so `existing.publisherId`/`existing.repoId` are `undefined` for both sides
// and this check is a no-op there.
if (community && at >= 0) {
  const existing = index[key][at];
  if (existing.publisherId !== entry.publisherId || existing.repoId !== entry.repoId) {
    fail(
      `${entry.id} is recorded as publisherId ${existing.publisherId}/repoId ${existing.repoId} ` +
        `but this release carries publisherId ${entry.publisherId}/repoId ${entry.repoId} — ` +
        "ownership transfer is a manual maintenance commit (spec 0058 §8.5), not something " +
        "an automated upsert does",
    );
  }
}
if (at >= 0) index[key][at] = entry;
else index[key].push(entry);
index.updatedAt = new Date().toISOString().slice(0, 10);

const serialized = `${JSON.stringify(index, null, 2)}\n`;
JSON.parse(serialized); // self-check: output must round-trip before we write it
writeFileSync(args.index, serialized);
console.log(`upserted ${entry.id}@${entry.version} -> ${entry.downloadUrl}`);

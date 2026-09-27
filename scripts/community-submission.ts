/**
 * §380 gates 1, 2, 4 and 9 — the community descriptor and the pure judgments over it
 * (spec 0058 §7.1–§7.2).
 *
 * A descriptor is `community/<id>.json` in `sayinel/baram-plugins`, written by the author:
 * `{ id, publisher, repo, release: { tag, asset, sha256 } }`. It is a REQUEST. What gets
 * published is decided from the ZIP it names (the manifest is the only source of the version,
 * name and capabilities) and from GitHub's numeric ids — never from what the author typed about
 * themselves. So every unknown field is refused: an author who adds `"version"` learns here
 * that it would be ignored.
 *
 * Shared by the pull-request gate (`community-gate.ts`) and the publish reconcile
 * (`community-publish.ts`), so the two cannot disagree about what a descriptor says.
 */
import { isGithubLogin } from "../src/plugins/community-registry";
import { compareVersions } from "../src/plugins/version-range";

/**
 * Gate 1 — a descriptor is ~250 bytes. No Rust constant to scrape: the app never reads
 * descriptors, so this bounds PR-controlled input to the gate itself, nothing more.
 */
export const MAX_SUBMISSION_BYTES = 4 * 1024;

/**
 * Reserved for first-party plugins (spec 0058 §7.2 gate 2, §8.3). Not imported — copied, like
 * the app's own copy. Four places hold this prefix as the literal that ENFORCES the
 * reservation (measured: `find src src-tauri/src scripts -type f \( -name '*.ts' -o -name
 * '*.tsx' -o -name '*.rs' -o -name '*.mjs' \) | xargs grep -nF 'baram-'`, filtered to the
 * reserved-id-prefix rule — corpus is src/, src-tauri/src/, scripts/, excluding tests and this
 * comment, and excluding every hit that is not an id-reservation check (e.g. the
 * `.baram-extract-` temp-dir prefix in `src-tauri/src/fs/mod.rs`; the
 * `https://sayinel.github.io/baram-plugins/` URL-prefix hits in `registry.rs`, all inside
 * `#[cfg(test)]`; and `mod.rs`'s `FIRST_PARTY_REVOCATION_PREFIX`, which `fetch.rs` reads to
 * decide whether a fetched `revoked.json` is the first-party one worth verifying a signature
 * against — it arms a signature check, not a fetch-origin bound):
 *   `src/plugins/community-registry.ts` `FIRST_PARTY_ID_PREFIX`,
 *   `src-tauri/src/plugin/dev_mode.rs` `FIRST_PARTY_PREFIX`,
 *   `scripts/update-registry-index.mjs`'s `manifest.id.startsWith("baram-")` (added by §381 —
 *   plain Node, so it cannot import this module), and this one.
 * That grep's extension list has no `.json`, so it does NOT see the two i18n strings that also
 * spell "baram-" (`src/i18n/en.json` and `ko.json`, key `plugin.dev.error.idReserved`) — those
 * are prose copies of `dev_mode.rs`'s refusal for display, not a fifth enforcement site.
 *
 * A test (`community-submission.test.ts`, a boundary corpus comparing `parseSubmission` against
 * `applyCommunityRules`) pins only the app's TypeScript copy (`community-registry.ts`) and this
 * one equal. The Rust copy is pinned only to refusing `baram-x` (and admitting `my-baram-x`), by
 * `dev_mode.rs`'s `a_release_build_refuses_a_first_party_id` and
 * `src-tauri/src/commands/plugin_dev_cmd.rs`'s
 * `a_release_build_refuses_a_first_party_id_and_grants_it_nothing`. Reasoned through, not just
 * asserted: `id.starts_with(FIRST_PARTY_PREFIX)` on `"baram-x"` stays true for every PREFIX of
 * `"baram-x"` (`"b"` … `"baram-"`, six strings — the last of which is the current value) and
 * for `"baram-x"` itself (a seventh), and `"my-baram-x"` starts with none of those seven (it
 * starts with `"my-"`) — so a drift of the constant to any of the seven passes both tests
 * undetected. Nothing LONGER than `"baram-x"` can: `"baram-x"` would
 * then no longer start with it, and the refusal test goes red. The `.mjs` copy is pinned only by
 * `registry-index-script.test.ts`'s `"a first-party id"` row
 * (`{ ...COMMUNITY_MANIFEST, id: "baram-hello" }`), which catches the prefix being removed or
 * loosened but, like the Rust pin, not a drift among the prefixes of `"baram-hello"` that still
 * refuses it.
 */
export const FIRST_PARTY_PREFIX = "baram-";

/**
 * The id rule spec 0058 §7.2 gate 2 sets for a submission, matching `plugin-release.yml`'s own
 * manifest-id check. Exported for `scripts/validate-index.ts`'s community charset check: the
 * PRIMARY reason to refuse an id outside this pattern is gate 2 itself — the submission gate
 * refuses it, so no honestly-submitted entry has one.
 *
 * ‼️ NOT THE SAME CHARSET THE APP INSTALLS BY — do not cite installability for a violation this
 * regex catches but a looser one would not. The app's own id gates anchor nothing at the first
 * character: `src/plugins/manifest.ts`'s `validateManifest` and `src-tauri/src/plugin/mod.rs`'s
 * manifest loader both accept `/^[a-z0-9-]+$/`, so `-foo` (leading hyphen) passes both and IS
 * installable. The install argument holds only for a character truly outside `[a-z0-9-]`
 * (uppercase, unicode, etc.): `src-tauri/src/plugin/install.rs`'s `commit_staged_plugin_install`
 * refuses the install when `manifest.id() != expected_id` (byte-for-byte), and a manifest can
 * never spell such a character at all — a registry id containing one can never match.
 */
export const ID_RE = /^[a-z0-9][a-z0-9-]*$/u;
/**
 * The repo-name charset gate 2 applies to a submission's `repo` — exported for
 * `scripts/validate-index.ts` and copied (this module is TypeScript, `update-registry-index.mjs`
 * is plain Node) into `scripts/update-registry-index.mjs`'s `REPO_NAME_RE`, both pointing back
 * here. The charset alone admits `.` and `..`, so every caller pairs it with an explicit
 * exclusion of those two — see the two checks below and in the two callers.
 */
export const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/u;
const TAG_RE = /^v?(\d+\.\d+\.\d+)$/u;
const ASSET_RE = /^[A-Za-z0-9._-]+\.zip$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const DESCRIPTOR_KEYS = ["id", "publisher", "release", "repo"];
const RELEASE_KEYS = ["asset", "sha256", "tag"];
/** Every field name `parseSubmission` reads, top-level and nested — used only to scan for duplicates. */
const ALL_KNOWN_KEYS = [...DESCRIPTOR_KEYS, ...RELEASE_KEYS];

export interface Submission {
  id: string;
  publisher: string;
  release: { asset: string; sha256: string; tag: string };
  repo: string;
}

export type SubmissionVerdict =
  | { error: string; ok: false; step: 1 | 2 }
  | { ok: true; submission: Submission };

export type Verdict<T extends object = object> =
  | (T & { ok: true })
  | { error: string; ok: false };

/**
 * The names a release publishes under — `plugins/<zip>`, and `readme/<readme>` when its archive
 * has a README. One spelling for the gate, which stages the entry, and the publish job, which
 * writes the files the entry's `downloadUrl` and `readme` name.
 */
export function assetNames(id: string, version: string): { readme: string; zip: string } {
  return { readme: `${id}-${version}.md`, zip: `${id}-${version}.zip` };
}

/** `community/<id>.json` → id. A subdirectory, another extension or an uppercase id → null. */
export function descriptorIdFromPath(path: string): null | string {
  const match = /^community\/([a-z0-9][a-z0-9-]*)\.json$/u.exec(path);
  return match === null ? null : match[1];
}

/**
 * The `repository` a community entry carries for this submission. The gate stages it, the publish
 * job writes it, and the gate's `reviewReasons` compares the published entry's against it — two
 * spellings that drifted apart would send every update to a person as "repository changed".
 */
export function repositoryUrl(submission: Submission): string {
  return `https://github.com/${submission.repo}`;
}

/**
 * Gates 1 and 2. `expectedId` is the id the FILE NAME carries — a body naming another id would
 * let one path pass gate 0 while the descriptor spoke for a different plugin.
 */
export function parseSubmission(bytes: Uint8Array, expectedId: string): SubmissionVerdict {
  if (bytes.length > MAX_SUBMISSION_BYTES) {
    return {
      error: `the descriptor is ${bytes.length} bytes, over the ${MAX_SUBMISSION_BYTES}-byte limit`,
      ok: false,
      step: 1,
    };
  }
  const refuse = (error: string): SubmissionVerdict => ({ error, ok: false, step: 2 });
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refuse("the descriptor is not valid UTF-8 JSON");
  }
  /**
   * No backslash, anywhere in the text. A JSON string spells a literal quote or a Unicode
   * escape only through a backslash, so refusing every backslash closes an escaped key —
   * `i` + backslash + `u0064` reading back as `id` — and, checked BEFORE the duplicate-key scan
   * below, it also guarantees no string VALUE can hide a quote that scan could mistake for a
   * key: an unescaped quote inside a JSON string ends the string, and escaping one needs a
   * backslash too, already refused here.
   */
  if (text.includes("\\")) {
    return refuse(
      "the descriptor may not contain a backslash — an escaped key would let this gate and a PR reviewer read a different field",
    );
  }
  const duplicate = duplicateKeyIn(text);
  if (duplicate !== null) {
    return refuse(
      `duplicate key "${duplicate}" in the descriptor — a PR reviewer reads its first occurrence, but JSON.parse silently keeps the last`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse("the descriptor is not valid UTF-8 JSON");
  }
  if (!isRecord(raw)) return refuse("the descriptor must be a JSON object");
  const unknownKeys = Object.keys(raw).filter((key) => !DESCRIPTOR_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    return refuse(
      `unknown field(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")} — the version, name and capabilities come from the manifest inside the ZIP, never from the descriptor`,
    );
  }
  const { id, publisher, release, repo } = raw;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    return refuse("id must match /^[a-z0-9][a-z0-9-]*$/");
  }
  if (id !== expectedId) {
    return refuse(`id ${JSON.stringify(id)} does not match the file name community/${expectedId}.json`);
  }
  if (id.startsWith(FIRST_PARTY_PREFIX)) {
    return refuse(`ids starting with "${FIRST_PARTY_PREFIX}" are reserved for first-party plugins`);
  }
  if (!isGithubLogin(publisher)) return refuse("publisher must be a GitHub login");
  if (typeof repo !== "string") return refuse('repo must be "<owner>/<name>"');
  const parts = repo.split("/");
  if (parts.length !== 2 || !REPO_NAME_RE.test(parts[1]) || parts[1] === "." || parts[1] === "..") {
    return refuse('repo must be "<owner>/<name>"');
  }
  if (parts[0] !== publisher) {
    return refuse(
      `the repo's owner ${JSON.stringify(parts[0])} must be the publisher ${JSON.stringify(publisher)} — organization-owned repositories are not accepted yet`,
    );
  }
  if (!isRecord(release)) return refuse("release must be an object with tag, asset and sha256");
  const unknownRelease = Object.keys(release).filter((key) => !RELEASE_KEYS.includes(key));
  if (unknownRelease.length > 0) {
    return refuse(`unknown release field(s) ${unknownRelease.map((key) => JSON.stringify(key)).join(", ")}`);
  }
  const { asset, sha256, tag } = release;
  if (typeof tag !== "string" || !TAG_RE.test(tag)) {
    return refuse("release.tag must be <version> or v<version>, e.g. v1.2.0");
  }
  if (typeof asset !== "string" || !ASSET_RE.test(asset)) {
    return refuse("release.asset must be a .zip file name made of [A-Za-z0-9._-]");
  }
  if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) {
    return refuse("release.sha256 must be 64 lowercase hex characters");
  }
  return { ok: true, submission: { id, publisher, release: { asset, sha256, tag }, repo } };
}

/** The version a release tag names — `v1.2.0` and `1.2.0` both mean 1.2.0. */
export function tagVersion(tag: string): string {
  const match = TAG_RE.exec(tag);
  if (match === null) throw new Error(`not a release tag: ${tag}`);
  return match[1];
}

/**
 * Gate 4 — one id, one plugin, across BOTH files. An id in `index.json` (plugin or theme) is
 * never a community id; inside `community.json` an update may only speak for its own single
 * entry — two entries under one id is a document nobody should guess about.
 */
export function idConflict(
  id: string,
  firstPartyIds: readonly string[],
  communityIds: readonly string[],
): null | string {
  if (firstPartyIds.includes(id)) return `id ${JSON.stringify(id)} is already taken in index.json`;
  const own = communityIds.filter((other) => other === id).length;
  if (own > 1) {
    return `community.json already holds ${own} entries for ${JSON.stringify(id)} — refusing to guess which one this updates`;
  }
  return null;
}

/** Gate 9 — strictly newer than what is published. An unparseable version never advances. */
export function versionAdvances(next: string, published: string | undefined): boolean {
  if (compareVersions(next, next) === null) return false;
  if (published === undefined) return true;
  const order = compareVersions(next, published);
  return order !== null && order > 0;
}

/**
 * A known key repeated in the raw text, or null. `DESCRIPTOR_KEYS` and `RELEASE_KEYS` share no
 * name, so counting each of `ALL_KNOWN_KEYS` once over the WHOLE text — regardless of nesting —
 * catches a duplicate at either level. Safe to run on raw text only because `parseSubmission`
 * already refused every backslash above: with no escape possible, a JSON string value can never
 * contain a `"`, so `"<key>"\s*:` can only match an actual key, never text inside a value.
 */
function duplicateKeyIn(text: string): null | string {
  for (const key of ALL_KNOWN_KEYS) {
    const count = (text.match(new RegExp(`"${key}"\\s*:`, "gu")) ?? []).length;
    if (count > 1) return key;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

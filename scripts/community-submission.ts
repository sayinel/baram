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
 * the app's own copy. Three places hold this prefix as a literal (measured:
 * `grep -rn '"baram-"' src/ src-tauri/src/ scripts/`, excluding tests and the i18n string that
 * only displays it): `src/plugins/community-registry.ts` `FIRST_PARTY_ID_PREFIX`,
 * `src-tauri/src/plugin/dev_mode.rs` `FIRST_PARTY_PREFIX`, and this one. A test
 * (`community-submission.test.ts`, a boundary corpus comparing `parseSubmission` against
 * `applyCommunityRules`) pins only the app's TypeScript copy and this one equal. The Rust copy
 * is pinned only to refusing `baram-x`, by `dev_mode.rs`'s `a_release_build_refuses_a_first_party_id`
 * — a drift there to a shorter or longer prefix is not caught by anything in this repo.
 */
export const FIRST_PARTY_PREFIX = "baram-";

/** The id rule `plugin-release.yml` and `update-registry-index.mjs` apply to manifests. */
const ID_RE = /^[a-z0-9][a-z0-9-]*$/u;
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/u;
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

/** `community/<id>.json` → id. A subdirectory, another extension or an uppercase id → null. */
export function descriptorIdFromPath(path: string): null | string {
  const match = /^community\/([a-z0-9][a-z0-9-]*)\.json$/u.exec(path);
  return match === null ? null : match[1];
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

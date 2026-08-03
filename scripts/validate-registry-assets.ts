/**
 * Checks that every `index.json` entry points at an archive that actually EXISTS in the
 * registry and hashes to the checksum the entry declares (§69).
 *
 * ‼️ THE ONE CHECK THAT CANNOT RUN IN THIS REPO. `validate-index.ts` judges the document —
 * field types, tiers, capabilities, the version floor, the URL's scheme. It has never
 * opened a single ZIP, because in the app repo there are none: the archives live in
 * `sayinel/baram-plugins` alongside the index that names them. So the two failures a user
 * meets most directly have had no gate at all:
 *
 * - `downloadUrl` names a file that is not there → every install of that entry 404s
 * - the file is there but its sha256 is not the entry's → every install fails its integrity
 *   check, which the app reports as a checksum mismatch rather than as a registry mistake
 *
 * Both deploy cleanly, serve a 200 for `index.json`, and look perfect in every existing
 * gate. The second is the worse one: an operator who pasted a stale checksum sees a healthy
 * index and a stream of users reporting that a plugin "won't install".
 *
 * ‼️ THE HARD PART IS RESOLVING THE URL THE WAY THE SERVER WILL. A gate that hashes a
 * different file than the one users download is worse than no gate, because it reports
 * success. See `resolveInRegistry` — the first version of this script was bypassable, and
 * the bypass was verified against production GitHub Pages.
 *
 * Run: npx tsx scripts/validate-registry-assets.ts <registry-root> [--base-url URL]
 *
 * `<registry-root>` is a checkout of the registry repo — the directory holding `index.json`
 * and `plugins/`.
 */
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";

import type {
  RevocationEntry,
  RevocationList,
} from "../src/plugins/revocation";

import {
  normalizeRevocationList,
  revocationFor,
} from "../src/plugins/revocation";
import { compareVersions } from "../src/plugins/version-range";
import { label } from "./gha-label";

/** Where the registry serves from. An entry pointing elsewhere is refused; see below. */
const DEFAULT_BASE_URL = "https://sayinel.github.io/baram-plugins/";

/**
 * ‼️ A REAL FLAG LOOP, not `args.find((a) => !a.startsWith("--"))` (review LOW-2).
 *
 * That predicate matched the FLAG'S VALUE when the flag came first, so
 * `--base-url https://x/ ./registry` took the URL as the registry root and failed with a
 * nonsense ENOENT. It fails closed, and `plugin-release.yml` happens to pass the positional
 * first — but `npm run validate:registry-assets` takes its arguments from whoever calls it,
 * and nothing said the order was load-bearing.
 */
function parseArgs(argv: string[]): { baseUrl: string; root: string } {
  let baseUrl = DEFAULT_BASE_URL;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      const value = argv[i + 1];
      if (value === undefined) {
        // Falling back to the default silently would mean a caller who asked for a
        // different registry got this one, checked, and was told it was fine.
        console.error("✗ --base-url given with no value");
        process.exit(1);
      }
      baseUrl = value;
      i += 1;
    } else if (arg.startsWith("--")) {
      console.error(`✗ unknown flag ${label(arg)}`);
      process.exit(1);
    } else {
      positional.push(arg);
    }
  }
  return {
    baseUrl: baseUrl.replace(/\/*$/u, "/"),
    root: resolve(positional[0] ?? "."),
  };
}

const { baseUrl, root } = parseArgs(process.argv.slice(2));
const indexPath = join(root, "index.json");

const errors: string[] = [];
const warnings: string[] = [];
/** Withdrawals `revoked.json` already accounts for — said once, not warned about forever. */
const notices: string[] = [];
/** Entries this script could not judge, so the summary cannot imply that it did. */
let unchecked = 0;

function fail(message: string): never {
  console.error(`✗ ${indexPath}: ${message}`);
  process.exit(1);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(indexPath, "utf8")) as unknown;
} catch (err) {
  // Labelled: Node embeds a snippet of the offending input in `SyntaxError.message`
  // (review LOW-10), and this runs inside GitHub Actions.
  fail(`not valid JSON — ${label(String(err))}`);
}

if (typeof raw !== "object" || raw === null) {
  fail("not a JSON object — the app cannot read this as an index at all");
}

const plugins = (raw as { plugins?: unknown }).plugins;
if (!Array.isArray(plugins)) {
  fail("no `plugins` array — the app cannot read this as an index at all");
}

/**
 * The registry-relative path this URL will actually be served from, or a refusal.
 *
 * ‼️ PERCENT-DECODING IS THE WHOLE POINT (security review, HIGH-3). GitHub Pages decodes
 * before it resolves, and the first version of this script sliced the RAW url and handed it
 * to `join()`. Verified against production:
 *
 * ```text
 * GET /plugins/baram-word-count-2%2e0%2e0.zip  → 200   (%2e decoded to ".")
 * GET /plugins/%2e%2e/index.json               → 200   (traversal resolved)
 * ```
 *
 * So an entry could name `x-1.0.0%2ezip` — a benign file this script hashed — while every
 * user downloaded `x-1.0.0.zip`, a different file entirely. Reproduced at exit 0 against
 * the shipped script before this fix; the literal-`..` check missed it too.
 *
 * A URL not already in canonical form is REFUSED rather than normalised: if two spellings
 * reach the same file, this script and the server can disagree about which file that is,
 * and a gate cannot be built on that.
 */
function resolveInRegistry(
  url: string,
): { error: string } | { relative: string } {
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(baseUrl);
  } catch {
    return { error: `downloadUrl ${label(JSON.stringify(url))} is not a URL` };
  }
  if (
    parsed.origin !== base.origin ||
    !parsed.pathname.startsWith(base.pathname)
  ) {
    // ‼️ AN ERROR, not a warning, and the reasoning is about what a gate can promise. An
    // archive hosted elsewhere cannot be hashed here, so admitting one would mean this
    // script reports success over an entry it never checked — the silent-pass shape every
    // other gate in this repo is written against.
    //
    // It is also a policy statement worth making explicit: `plugin-release.yml` publishes
    // every archive into the registry's own Pages, so an off-registry URL today means a
    // hand-edited entry. ‼️And it is enforced ONLY here — the app's `validate_http_url`
    // checks the SCHEME and accepts any host — so this refusal is currently the only thing
    // anywhere that says where a plugin may come from.
    return {
      error:
        `downloadUrl ${label(JSON.stringify(url))} is not under ${baseUrl} — ` +
        "the archive cannot be verified here, so publishing it would mean shipping an " +
        "entry no gate has ever checked",
    };
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    return {
      error:
        `downloadUrl ${label(JSON.stringify(url))} carries a query or fragment, so the ` +
        "path actually served is ambiguous",
    };
  }
  const encoded = parsed.pathname.slice(base.pathname.length);
  let relative: string;
  try {
    relative = decodeURIComponent(encoded);
  } catch {
    return {
      error: `downloadUrl ${label(JSON.stringify(url))} has invalid percent-encoding`,
    };
  }
  // Canonical form only. `%2e` decodes to `.` and `encodeURI(".")` is `.`, so a URL that
  // spelled it the encoded way fails here — which is exactly the bypass above.
  if (encodeURI(relative) !== encoded) {
    return {
      error:
        `downloadUrl ${label(JSON.stringify(url))} is percent-encoded in a form the server ` +
        "decodes differently — write the path literally so this can check the file users get",
    };
  }
  if (
    relative === "" ||
    relative !== normalize(relative) ||
    relative.startsWith("/")
  ) {
    return {
      error: `downloadUrl ${label(JSON.stringify(url))} does not name a file inside the registry`,
    };
  }
  const file = resolve(root, relative);
  if (!file.startsWith(resolve(root) + sep)) {
    return {
      error: `downloadUrl ${label(JSON.stringify(url))} resolves outside the registry`,
    };
  }
  return { relative };
}

/** Archives an entry claimed, canonical, so orphans can be reported afterwards. */
const referenced = new Set<string>();

plugins.forEach((value, position) => {
  const entry = (value ?? {}) as Record<string, unknown>;
  const id = typeof entry.id === "string" && entry.id !== "" ? entry.id : null;
  const where = label(id ?? `entry #${position + 1}`);

  const url = entry.downloadUrl;
  const checksum = entry.checksum;
  if (typeof url !== "string" || typeof checksum !== "string") {
    // `validate-index.ts` owns the type table and says this far better, so the complaint is
    // left to it — but the entry is COUNTED, because "✓ 0 archive(s) present and matching"
    // over an index of nothing but unreadable entries reads as a verdict (review MEDIUM-1).
    // The two run together; this one must not imply it checked what it skipped.
    unchecked += 1;
    return;
  }

  const resolved = resolveInRegistry(url);
  if ("error" in resolved) {
    errors.push(`${where}: ${resolved.error}`);
    return;
  }
  const { relative } = resolved;
  // ‼️ EVERY message below prints `shown`, never `relative` (review HIGH-1). `relative`
  // comes straight out of `downloadUrl`, so it is exactly as attacker-controlled as the id
  // — and it was the one field this file printed raw, in the very script whose need for a
  // sanitizer is why `gha-label.ts` was extracted. A newline plus `::error title=…::` in a
  // downloadUrl wrote a forged annotation, and `::stop-commands::` silenced the real ones.
  const shown = label(relative);
  referenced.add(relative);

  const file = join(root, relative);
  // `lstat`, not `stat` (review MEDIUM-3): a symlink is FOLLOWED by both `stat` and
  // `readFileSync`, so the script would hash the target while Pages serves — or 404s on —
  // the link itself. Hashing a different file than users get is the failure this script
  // exists to prevent, so a link is refused rather than resolved. Also rejects a directory.
  if (!lstatSync(file, { throwIfNoEntry: false })?.isFile()) {
    errors.push(
      `${where}: ${shown} is not a regular file in the registry — the app would 404 on ` +
        "every install of this entry, after the marketplace has already offered it",
    );
    return;
  }
  // Case, checked explicitly: macOS and Windows resolve `W.ZIP` to `w.zip` and GitHub Pages
  // does not, so a maintainer running this locally would get a green over a URL that 404s
  // in production (review LOW-10). CI is Linux, but the npm script is for people.
  const basename = relative.slice(relative.lastIndexOf("/") + 1);
  if (!readdirSync(dirname(file)).includes(basename)) {
    errors.push(
      `${where}: ${shown} differs from the file on disk only by case — the registry is ` +
        "served case-sensitively, so this entry would 404 for every user",
    );
    return;
  }

  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== checksum) {
    errors.push(
      `${where}: ${shown} hashes to ${actual} but the entry declares ${label(checksum)} — ` +
        "the app verifies this before extracting, so every install fails and the user is " +
        "told the download was corrupted",
    );
  }
});

/**
 * Whether an archive filename is `<id>-<something starting with a digit>`.
 *
 * ‼️ ONE COPY, used by both the superseded check and the acknowledgement check. Matching a
 * bare `${id}-` prefix meant `baram-word-count` hid a withdrawn `baram-word-count-pro-1.0.0`
 * — the case the warning exists for (review MEDIUM-4). A second hand-written copy of this
 * rule would have drifted the first time either caller changed. (An earlier `.sort()` by
 * descending id length supposedly prevented it and was dead code: `.some()` short-circuits,
 * so the result never depended on order.)
 *
 * ‼️ It answers "could this name be this id's", NOT "is this id's". `baram-word` matches
 * `baram-word-2-1.0.0.zip`, which belongs to `baram-word-2`. That is why the caller also
 * requires the remainder to PARSE as a version — see `withdrawalFor`.
 *
 * ‼️ And that pair of rules is airtight only because plugin ids are DOTLESS: they match
 * `/^[a-z0-9-]+$/` (`manifest.ts`, `update-registry-index.mjs`). A hijack would need the
 * victim id to be `<claimant>-<rest>` with `<rest>` starting with a digit AND
 * `<rest>-<version>` parsing as a version — and with `<rest>` dotless the first `.` can only
 * come from the version, so the boundary never lines up. That cross-file invariant is not
 * restated here; if ids ever admit `.`, this reasoning has to be redone.
 */
const archiveBelongsTo = (name: string, id: string) =>
  name.startsWith(`${id}-`) && /^\d/u.test(name.slice(id.length + 1));

/**
 * Does this parse as semver, per the shipping parser?
 *
 * ‼️ THE HOLE THIS CLOSES (code review HIGH-1). `matchesRange(v, "*")` returns true WITHOUT
 * parsing `v`, so for a `"*"` entry the version check below was a no-op and acknowledgement
 * collapsed back to the bare-prefix rule: a revoked `baram-word` vouched for
 * `baram-word-2-1.0.0.zip`, a different plugin's withdrawn archive. Reproduced at the notice
 * level before this guard. Bounded ranges happened to be safe only because the hijacked
 * remainder fails to parse — luck, not a check, so the parse is now demanded outright.
 *
 * `compareVersions(v, v)` rather than a regex: a second hand-written notion of "a version"
 * is the same mistake as a second `archiveBelongsTo`.
 *
 * ‼️ It means "TRIMS to a version", not "is a version" — `parseVersion` calls `raw.trim()`
 * and coerces components with `Number`, so ` 1.0.0`, `1.0.0 ` and `1.0.01` all parse. That
 * leniency is right for the app, which reads a version out of a manifest; here the version
 * is inferred from a FILENAME, and two different files must not both claim one recorded
 * withdrawal. Whitespace is therefore refused outright — a published archive's name has
 * none, so this rejects a typo rather than redefining semver. Leading zeros and `+build`
 * are left to the parser: they are spellings the app would also treat as the same version,
 * and inventing a stricter grammar here is the mistake this comment opens by naming.
 */
const isSemver = (v: string) => !/\s/u.test(v) && compareVersions(v, v) !== null;

const indexedIds = plugins
  .map((p) => (p as null | { id?: unknown })?.id)
  .filter((id): id is string => typeof id === "string" && id !== "");

/**
 * The withdrawal list: what the app would read, and what the file merely CLAIMS.
 *
 * Both, because they answer different questions. `list` decides whether a withdrawal is
 * real — via the shipping parser, so this script and the app agree about which entries
 * exist and which versions each covers. `declaredIds` is every id the file mentions, even
 * in an entry the parser DROPS, and it exists only to make the ambiguity check honest
 * (review MEDIUM-2): a malformed rival is still a rival, and letting it vanish would leave
 * one claimant standing where the file names two.
 *
 * A null `list` means no acknowledgements at all — every orphan warns, the loud direction.
 * An unreadable list must never read as "everything is accounted for": that turns one
 * corrupt file into blanket silence over exactly the archives this scan is for.
 */
const revokedPath = join(root, "revoked.json");
const { declaredIds, list } = ((): {
  declaredIds: string[];
  list: null | RevocationList;
} => {
  // `lstat`, matching the archive check above: this file is PR-controlled in the registry's
  // `validate.yml`, and a link is not the file the app fetches (review LOW-8).
  const stat = lstatSync(revokedPath, { throwIfNoEntry: false });
  // Absent is quiet — the sibling `validate-revocations.ts` owns "there should be one", and
  // every orphan below warns anyway. Present-but-not-a-file is NOT quiet: something is there
  // and this script is declining to read it, which the operator has to be told.
  if (stat !== undefined && !stat.isFile()) {
    warnings.push(
      "revoked.json is not a regular file — a link or directory is not what the app " +
        "fetches, so no withdrawal below counts as acknowledged",
    );
  }
  if (!stat?.isFile()) return { declaredIds: [], list: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(revokedPath, "utf8"));
  } catch {
    warnings.push(
      "revoked.json is present but unreadable, so no withdrawal below counts as acknowledged",
    );
    return { declaredIds: [], list: null };
  }
  // ‼️ `?.`, because the JSON document `null` is a valid one-word file and parses to `null`
  // (code review MEDIUM-1). Reading `.revoked` off it threw an uncaught TypeError, and the
  // throw landed BEFORE the errors above were printed — a real checksum mismatch came back
  // as a stack trace instead of the verdict. `normalizeRevocationList` guards this itself;
  // the lstat restructure moved `raw` out of the try and past that guard.
  const declared = (raw as null | { revoked?: unknown })?.revoked;
  const list = normalizeRevocationList(raw);
  if (list === null) {
    warnings.push(
      "revoked.json is present but the app could not read it, so no withdrawal below " +
        "counts as acknowledged",
    );
  }
  return {
    declaredIds: (Array.isArray(declared) ? declared : [])
      .map((e) => (e as null | { id?: unknown })?.id)
      .filter((id): id is string => typeof id === "string" && id !== ""),
    list,
  };
})();

/**
 * The withdrawal that accounts for this archive, with the id it was matched under.
 *
 * Three refusals, all deliberate:
 *
 * - the remainder must PARSE as a version, whatever the range says. See `isSemver`: without
 *   this, a `"*"` entry skipped the version question entirely (review HIGH-1).
 * - the entry must then COVER that version, via the same `revocationFor` the app uses. An
 *   entry bounded `lt: 2.0.0` says nothing about a `-3.0.0.zip` sitting in the directory,
 *   and the point of that bound is that later majors are not withdrawn.
 * - an ambiguous name resolves to NOTHING. Ids `a` and `a-1` both claim `a-1-2.0.0.zip`
 *   under the prefix rule and nothing in the name says which; picking one lets whichever
 *   sorts first speak for an archive that may not be its own. Claimants come from
 *   `declaredIds`, so an entry the parser dropped still counts as a rival.
 */
function withdrawalFor(
  name: string,
): null | { entry: RevocationEntry; id: string } {
  if (list === null) return null;
  const claimants = [...new Set(declaredIds)].filter((id) =>
    archiveBelongsTo(name, id),
  );
  if (claimants.length !== 1) return null;
  const id = claimants[0];
  const version = name.slice(id.length + 1, name.length - ".zip".length);
  if (!isSemver(version)) return null;
  const entry = revocationFor(id, version, list);
  return entry === null ? null : { entry, id };
}

/**
 * Archives belonging to a plugin the index has WITHDRAWN — not merely superseded, and not
 * already accounted for in `revoked.json`.
 *
 * ‼️ Those two exclusions are what keep this warning worth reading, and they are the same
 * argument twice. Every update leaves the previous version's ZIP behind, so a bare "nothing
 * points at this file" fires once per release forever and the real case drowns in a decade
 * of `-1.0.0.zip`. A recorded withdrawal is the same shape: the decision exists, one file
 * over, and repeating it every run buys nothing. What is worth saying is that a plugin
 * removed from the index KEEPS SERVING its archive by direct URL — nothing in the app can
 * reach it, the index is the only way in, but a trusted-tier plugin pulled for cause is
 * still one `curl` away.
 *
 * ‼️ Which is also why deference stops at `unlisted`. "Pulled for cause" is precisely the
 * severity that must not go quiet; see the allowlist below.
 *
 * ‼️ And none of this is a security control. In the registry repo the same PR can author
 * both the archive and the `revoked.json` entry that excuses it (code review MEDIUM-5), and
 * every branch here exits 0 — this output is advisory, and PR review is the real gate. The
 * refusals exist so the advice stays true, not so it can be enforced.
 */
const pluginsDir = join(root, "plugins");
if (existsSync(pluginsDir)) {
  for (const name of readdirSync(pluginsDir).sort()) {
    const relative = `plugins/${name}`;
    if (referenced.has(relative) || !name.endsWith(".zip")) continue;
    if (indexedIds.some((id) => archiveBelongsTo(name, id))) continue;
    const withdrawal = withdrawalFor(name);
    // ‼️ ONLY `unlisted` goes quiet, and it is an allowlist rather than "not malicious"
    // (review MEDIUM-4). `unlisted` is the one severity the model DEFINES as no danger —
    // hygiene, the author went quiet, merged elsewhere. Everything else is a plugin pulled
    // for cause, and "a trusted-tier plugin pulled for cause is still one `curl` away" is
    // this scan's whole reason to exist: giving that case the quietest channel inverted it.
    // A denylist would also hand the same silence to whatever severity is added next.
    if (withdrawal?.entry.severity === "unlisted") {
      notices.push(
        `${label(relative)} belongs to ${label(withdrawal.id)}, withdrawn and recorded in ` +
          "revoked.json — the archive stays downloadable by direct URL, as decided",
      );
      continue;
    }
    if (withdrawal !== null) {
      warnings.push(
        `${label(relative)} belongs to ${label(withdrawal.id)}, revoked as ` +
          `${label(withdrawal.entry.severity)} — the archive is STILL downloadable by ` +
          "direct URL, which for this severity is worth saying every time",
      );
      continue;
    }
    warnings.push(
      `${label(relative)} belongs to no listed plugin and no revoked.json entry — a ` +
        "withdrawn plugin's archive stays downloadable by direct URL, and nothing here " +
        "records that anyone decided that",
    );
  }
} else {
  warnings.push(
    "no plugins/ directory — nothing scanned for withdrawn archives",
  );
}

for (const notice of notices) console.log(`· ${indexPath}: ${notice}`);
for (const warning of warnings) console.warn(`⚠ ${indexPath}: ${warning}`);

if (errors.length > 0) {
  console.error(`✗ ${indexPath}: ${errors.length} problem(s)`);
  for (const error of errors) console.error(`    ${error}`);
  process.exit(1);
}

console.log(
  `✓ ${indexPath}: ${referenced.size} archive(s) present and matching` +
    (unchecked > 0
      ? ` (${unchecked} entry/entries not checkable here — see validate-index.ts)`
      : "") +
    (notices.length > 0
      ? ` (${notices.length} acknowledged withdrawal(s))`
      : "") +
    (warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""),
);

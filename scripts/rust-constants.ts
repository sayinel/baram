/**
 * Read constants the APP compiled in, out of the Rust that enforces them (§69).
 *
 * ‼️ WHY SCRAPING RATHER THAN A SECOND LITERAL. The publish gates' decisions are only meaningful
 * against what a CLIENT will do: which key it verifies with, how many bytes of a document it
 * will fetch, and — for the §380 community gate — which archive shape a client's install will
 * actually extract (the download cap and the seven extraction values below). A copy of any of
 * these here would be a value that can drift from the one enforced, and every drift is silent —
 * a stale key verifies nothing users hold, a stale byte cap publishes a document no client can
 * read, and a stale extraction value publishes an archive no client's install will finish. So the
 * gate reads Rust.
 *
 * ‼️ EVERY SCAN ASSERTS THE MATCH COUNT, and every one of them is a FUNCTION OVER SOURCE TEXT
 * rather than a file reader. The count is because these identifiers also appear at call sites, in
 * comments and in Rust's own tests, so "a match exists" does not mean it is the value that ships —
 * `dev/backlog.md` records four separate times this feature made exactly that mistake. Taking text
 * is what lets a test feed a crafted source and see the refusal; the first version of the byte-cap
 * scrape read the file itself, so its count assertion had no way to be exercised and a mutation
 * loosening it survived.
 *
 * They THROW rather than exiting, so the caller decides what a failure means: the validator turns
 * it into its own `✗` refusal, the gate script into an `::error::` and exit 2.
 *
 * ‼️ THE COUNT IS NOT THE WHOLE DEFENCE, AND THE SIX SCRAPES THIS FILE MAKES FOR A PUBLISH GATE
 * ARE NOT EQUALLY PROTECTED. Two gates share this file: the FIRST-PARTY revocation/registry
 * publish gate (the key, the revocation cap, the registry cap) and the §380 COMMUNITY submission
 * gate (the plugin archive byte cap, the seven extraction values behind the shared zip core's six
 * defences, and the README cap). The first version of this header implied a single cap and equal
 * protection for both scrapes it named (security review NEW-2); the revocation cap set the WEAKER
 * kind, and every cap after it — the registry cap and now the §380 caps — is another instance of
 * that same kind, not a distinct one. Counting stops a declaration being ADDED; it cannot stop the
 * real one being respelled past the pattern while a decoy comment keeps the count at 1. What
 * closes that is a CROSS-LANGUAGE ANCHOR — an assertion on the compiled value that goes red when
 * the scraped value drifts from it. Other exported scrapes in this file (inline media, approval
 * error codes, dev mode, `pick_approved_dir` params, plugin capabilities, the two theme byte caps,
 * the §385 sandbox report cap) serve other checks — they are not part of either publish gate and
 * are not counted here.
 *
 * - the key has one: vitest binds the scraped key to the frozen at-arming pair and
 *   `mod.rs`'s own test binds the compiled key to the same two files, so a divergence is
 *   self-contradictory in both directions.
 * - every cap has a WEAKER one, the same shape throughout:
 *   `the_fetch_cap_is_the_number_the_publish_gate_scrapes` in `origin.rs` (MAX_REVOCATION_BYTES),
 *   `the_registry_cap_is_the_number_the_publish_gate_scrapes` in `fetch.rs` (MAX_REGISTRY_BYTES),
 *   `the_archive_bounds_are_the_numbers_the_community_gate_scrapes` in `limits.rs` (the six
 *   numeric bounds `pluginArchiveLimits` reads via `bound()`, plus the ALLOWED_COMPRESSION method
 *   list — the same test asserts all seven, and MAX_PLUGIN_ARCHIVE_BYTES besides), and
 *   `the_readme_cap_is_the_number_the_community_gate_scrapes` in `fetch.rs` (MAX_README_BYTES).
 *   Without the first, `const MAX_REVOCATION_BYTES: usize = ONE_MIB;` plus a decoy comment in the
 *   matched form left this returning 1 MiB while clients capped at whatever `ONE_MIB` said — and an
 *   oversized list then publishes green and no client can read it.
 *
 * ‼️ THE KEY'S ANCHOR AND THE CAPS' ANCHORS ARE NOT THE SAME STRENGTH, and calling them "the same
 * discipline" flattened a real difference (third-round security review Q4/L-1). The key's anchor is
 * a SIGNATURE: unforgeable without the private half, and red in both directions. Each cap's is a
 * NUMBER (or, for `ALLOWED_COMPRESSION`, an enum array compared element-by-element) asserted
 * against a hand-written literal on each side — neither assertion compares scraped against
 * compiled, both compare against a constant a commit can edit. A reviewer measured the cost of
 * defeating one: the decoy, the indirection, and ONE literal edit in the Rust test. So each is a
 * DRIFT GUARD, and its value is that the diff is unmissable — a new `const ONE_MIB` beside a
 * re-pointed constant and a changed assertion literal is not something a reviewer reads past.
 */

/**
 * The byte cap `MAX_REVOCATION_BYTES` applies to the revocation list a client fetches.
 *
 * Written as a product of integers (`1024 * 1024`), and that is the only form accepted — anything
 * else throws instead of being read as a smaller number.
 */
export function revocationByteCap(rustSource: string): number {
  const literal = soleDeclaration(
    rustSource,
    /MAX_REVOCATION_BYTES\s*:\s*usize\s*=\s*([0-9_ *]+);/gu,
    "MAX_REVOCATION_BYTES",
  );
  return integerProduct(literal, "MAX_REVOCATION_BYTES");
}

/**
 * The byte cap `MAX_REGISTRY_BYTES` applies to the registry index a client fetches
 * (`fetch_registry` in `src-tauri/src/plugin/fetch.rs`).
 *
 * The same form rule as `revocationByteCap`: a product of integers, anything else throws.
 */
export function registryByteCap(rustSource: string): number {
  const literal = soleDeclaration(
    rustSource,
    /MAX_REGISTRY_BYTES\s*:\s*usize\s*=\s*([0-9_ *]+);/gu,
    "MAX_REGISTRY_BYTES",
  );
  return integerProduct(literal, "MAX_REGISTRY_BYTES");
}

/**
 * The key `REVOCATION_PUBLIC_KEY` holds, i.e. the one an armed client verifies with.
 *
 * ‼️ Counting guards against a declaration being ADDED, not against the real one being respelled
 * so the pattern misses it while a planted comment matches (security review HIGH-2). The lifetime
 * and loose spacing are accepted so those spellings stay counted; the rest is closed by the gate
 * script, which checks the scraped key against a signature this repository froze — a planted key
 * cannot verify it.
 */
export function shippedRevocationPublicKey(rustSource: string): string {
  return soleDeclaration(
    rustSource,
    /REVOCATION_PUBLIC_KEY\s*:\s*&(?:'static\s+)?str\s*=\s*"([^"]*)"/gu,
    "REVOCATION_PUBLIC_KEY",
  );
}

/**
 * §324-e The media extensions `read_media_data_url` will open, read out of the table
 * that enforces them (`src-tauri/src/fs/media.rs`).
 *
 * ‼️ WHY SCRAPING RATHER THAN A SECOND LITERAL — the same reasoning as the two scrapes
 * above. That table is an ALLOWLIST: an extension missing from it cannot be dropped into
 * a capture, and an extension present in it can be read from anywhere on disk. The
 * frontend has its own canonical media enumeration (`IMAGE_EXTENSIONS` in
 * `utils/path-utils.ts` unioned with the video set in `utils/media-src.ts`, which
 * `isMediaFilePath` joins), and the two are in different languages. A hand-copied list
 * here would be a third value free to drift from both, and both drifts are silent: an
 * extension the frontend offers but Rust refuses looks to the user like a drop that did
 * nothing, and one Rust admits but the frontend never offers is allowlist surface with no
 * caller. This repo has been bitten by exactly this — a video extension list that reached
 * four copies, and a `.md` check whose case-sensitivity diverged across languages.
 *
 * The consumer is `src/utils/__tests__/media-extension-parity.test.ts`.
 *
 * ‼️ THE COUNT ASSERTION IS LOAD-BEARING, as it is for the two above: `MEDIA_MIME_TYPES`
 * is also named at its call site and in that module's tests, so "a match exists" would not
 * mean it is the table that ships. A FUNCTION OVER SOURCE TEXT rather than a file reader,
 * so a test can feed crafted source and watch the refusal.
 */
export function inlineMediaExtensions(rustSource: string): Set<string> {
  const body = soleDeclaration(
    rustSource,
    /MEDIA_MIME_TYPES\s*:\s*&\[\(&str,\s*&str\)\]\s*=\s*&\[([^\]]*)\]/gu,
    "MEDIA_MIME_TYPES",
  );
  const extensions = [
    ...body.matchAll(/\(\s*"([^"]+)"\s*,\s*"[^"]+"\s*\)/gu),
  ].map((m) => m[1]);
  if (extensions.length === 0) {
    throw new Error(
      "MEDIA_MIME_TYPES parsed to an empty table — refusing to compare",
    );
  }
  return new Set(extensions);
}

/**
 * §324-e The byte cap `MAX_INLINE_MEDIA_BYTES`, i.e. the largest file the capture dialog
 * will inline as a `data:` URL. Same product-of-integers form as the revocation cap.
 */
export function inlineMediaByteCap(rustSource: string): number {
  const literal = soleDeclaration(
    rustSource,
    /MAX_INLINE_MEDIA_BYTES\s*:\s*u64\s*=\s*([0-9_ *]+);/gu,
    "MAX_INLINE_MEDIA_BYTES",
  );
  return integerProduct(literal, "MAX_INLINE_MEDIA_BYTES");
}

/**
 * §333 The two error codes `approval_cmd` returns, read out of the Rust that produces them.
 *
 * ‼️ WHY SCRAPING RATHER THAN A SECOND LITERAL — these two strings ARE the protocol between
 * the gate and the frontend, and both drifts are silent. If the denial code drifts, a user's
 * "Deny" arrives as an unrecognised error: `use-app-startup` classifies it as stale and
 * DELETES the persisted context, and `switchContext` loads the tree anyway. If the
 * unresolvable code drifts into the denial code, a deleted vault reports a refusal for a
 * dialog nobody saw. Neither shows up as a type error, and neither shows up in a test that
 * hard-codes the same literal on both sides.
 *
 * ‼️ THE COUNT ASSERTION IS LOAD-BEARING, as for every scrape above: both identifiers also
 * appear at their `.to_string()` call sites and in this crate's own tests, so "a match
 * exists" would not mean it is the constant that ships. The pattern therefore requires the
 * DECLARATION form (`: &str = "…"`). A FUNCTION OVER SOURCE TEXT rather than a file reader,
 * so a test can feed crafted source and watch the refusal.
 *
 * The consumer is `src/ipc/__tests__/approval-error-codes.test.ts`.
 */
export function approvalErrorCodes(rustSource: string): {
  denied: string;
  unresolvable: string;
} {
  return {
    denied: soleDeclaration(
      rustSource,
      /APPROVAL_DENIED\s*:\s*&(?:'static\s+)?str\s*=\s*"([^"]*)"/gu,
      "APPROVAL_DENIED",
    ),
    unresolvable: soleDeclaration(
      rustSource,
      /PATH_UNRESOLVABLE\s*:\s*&(?:'static\s+)?str\s*=\s*"([^"]*)"/gu,
      "PATH_UNRESOLVABLE",
    ),
  };
}

/**
 * §379 The developer-mode refusal codes `src-tauri/src/plugin/dev_mode.rs` declares
 * (`pub const DEV_…: &str = "…"`), by name.
 *
 * Collects EVERY `DEV_` declaration rather than a list of names written here: a code Rust adds
 * later must reach the consumer's "is it translated?" check without anyone editing this file.
 * Each name must be declared once — two declarations of one name leave no way to know which
 * ships. A FUNCTION OVER SOURCE TEXT, so a test can feed crafted source and watch the refusal.
 *
 * ‼️ THE MAIN PATTERN REQUIRES `pub const …: &str = "…"` — it does not match a `pub(crate)
 * const` (still a real declaration a caller in this crate could reach) or a name carrying a
 * digit (`[A-Z_]+` has none). Either would silently NOT become a code this scrape returns,
 * while `DEV_MODE_MUTEX` — a `static`, not a `const` — must keep NOT counting. So a second,
 * looser scan (`\bconst\s+DEV_[A-Z0-9_]*\b`, catching any visibility and any digit) counts
 * every `const DEV_…` declaration regardless of type, and its count is compared against
 * `codes.size` — a mismatch means the strict pattern missed one.
 *
 * The consumer is `src/ipc/__tests__/dev-mode-error-codes.test.ts`.
 */
export function devModeErrorCodes(rustSource: string): Map<string, string> {
  const codes = new Map<string, string>();
  for (const m of rustSource.matchAll(
    /pub\s+const\s+(DEV_[A-Z_]+)\s*:\s*&(?:'static\s+)?str\s*=\s*"([^"]*)"/gu,
  )) {
    if (codes.has(m[1])) {
      throw new Error(
        `found 2 declarations of ${m[1]} — refusing to guess which one ships`,
      );
    }
    codes.set(m[1], m[2]);
  }
  if (codes.size === 0) {
    throw new Error(
      "found no DEV_ error codes — the pattern no longer matches dev_mode.rs",
    );
  }
  const anyDevConst = [
    ...rustSource.matchAll(/\bconst\s+DEV_[A-Z0-9_]*\b/gu),
  ].length;
  if (anyDevConst !== codes.size) {
    throw new Error(
      `found ${anyDevConst} "const DEV_…" declarations of any visibility but only ` +
        `${codes.size} matched the strict "pub const …: &str" pattern — a pub(crate) or ` +
        "digit-bearing DEV_ constant is going untranslated",
    );
  }
  return codes;
}

/**
 * The parameter names `pick_approved_dir` declares, minus the `app` handle Tauri injects.
 *
 * ‼️ WHY SCRAPING RATHER THAN A SECOND LITERAL — Tauri matches a command's parameters to the keys
 * in the invoke payload, converting camelCase to snake_case. A key the command does not declare is
 * silently DROPPED: no type error (the TS wrapper is fine), no runtime error (the command runs), and
 * the parameter simply arrives as `None`. For `start_dir` that means the picker quietly opens at the
 * home directory every time, which is also its legitimate fallback — so the defect is invisible in
 * the one place someone would look.
 *
 * ‼️ THE COUNT ASSERTION IS LOAD-BEARING, as everywhere above: `pick_approved_dir` also appears in
 * `generate_handler!`, in the IPC string on the TS side of the same repo, and in this crate's own
 * registration test. The pattern therefore requires the `pub async fn … (…)` DECLARATION form. A
 * FUNCTION OVER SOURCE TEXT rather than a file reader, so a test can feed crafted source and watch
 * the refusal.
 *
 * The consumer is `src/ipc/__tests__/pick-approved-dir-args.test.ts`.
 */
export function pickApprovedDirParams(rustSource: string): string[] {
  const signature = soleDeclaration(
    rustSource,
    /pub\s+async\s+fn\s+pick_approved_dir\s*<[^>]*>\s*\(([^)]*)\)/gu,
    "pick_approved_dir",
  );
  const names = signature
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter((name) => name.length > 0 && name !== "app");

  // ‼️ The split is on every comma, so a future parameter whose TYPE carries one
  // (`Option<Result<A, B>>`) would be read as two parameters, one of them a fragment like "B>>".
  // Left unchecked that returns a plausible-looking list and the consumer compares the payload
  // against nonsense. Every Rust parameter name is a lowercase identifier, so anything else here
  // means the parse broke.
  for (const name of names) {
    if (!/^[a-z_][a-z0-9_]*$/u.test(name)) {
      throw new Error(
        `cannot read pick_approved_dir parameters: "${name}" is not a parameter name — the signature parse broke`,
      );
    }
  }
  return names;
}

/**
 * §69/§260 The capability allowlist `valid_caps` enforces in `validate_manifest`
 * (`src-tauri/src/plugin/mod.rs`), read out of the array literal that ships.
 *
 * ‼️ WHY SCRAPING RATHER THAN A SECOND LITERAL — the same reasoning as the scrapes above.
 * TypeScript's canonical list, `VALID_CAPABILITIES` (`src/plugins/manifest.ts`), is DERIVED
 * from the `PluginCapability` union via `CAPABILITY_DESCRIPTIONS`, so it cannot fall behind
 * the union by construction — but Rust keeps its own hand-written array, and nothing forced
 * the two to agree. A capability present in TS but missing here rejects every manifest that
 * declares it at BOTH of `validate_manifest`'s call sites in the crate — `read_manifest_at`
 * (dev folder, before TypeScript ever sees the manifest) and `read_staged_manifest` (install
 * from an archive) — so such a plugin is neither loadable nor installable. That is exactly
 * the defect this scrape exists to catch (a capability added to the union without a matching
 * entry here failed silently until someone tried to load a plugin that used it).
 *
 * The consumer is `src/plugins/__tests__/capability-parity.test.ts`.
 *
 * ‼️ THE COUNT ASSERTION IS LOAD-BEARING, as for every scrape above: `valid_caps` is also
 * named at its `.contains(&cap.as_str())` call site, so "a match exists" would not mean it is
 * the array that ships. The pattern therefore requires the `let valid_caps = [...]`
 * DECLARATION form. A FUNCTION OVER SOURCE TEXT rather than a file reader, so a test can feed
 * crafted source and watch the refusal.
 */
export function rustPluginCapabilities(rustSource: string): Set<string> {
  const body = soleDeclaration(
    rustSource,
    /let\s+valid_caps\s*=\s*\[([^\]]*)\]/gu,
    "valid_caps",
  );
  const capabilities = [...body.matchAll(/"([^"]+)"/gu)].map((m) => m[1]);
  if (capabilities.length === 0) {
    throw new Error("valid_caps parsed to an empty list — refusing to compare");
  }
  return new Set(capabilities);
}

/**
 * §360 The byte cap `MAX_STORED_THEME_CSS_BYTES` puts on one mode's stored theme CSS, read out of
 * the Rust that refuses the write (`src-tauri/src/plugin/install.rs`).
 *
 * ‼️ WHY SCRAPING RATHER THAN A SECOND LITERAL — the same reasoning as every scrape above, and the
 * drift is silent in both directions. The frontend refuses first so the author gets `tooLarge`
 * naming the stylesheet rather than an opaque commit failure; Rust refuses because the frontend is
 * not entitled to be believed about what it is asking to have written. If the frontend copy drifted
 * HIGHER, a theme would sail through the hygiene pipeline and die at the commit with the wrong
 * diagnosis; if it drifted LOWER, themes the backend would happily store would be refused with no
 * way for the author to find out why. Neither shows up in a test that hard-codes the same number on
 * both sides.
 *
 * ‼️ THE COUNT ASSERTION IS LOAD-BEARING, as everywhere above: this identifier also appears at its
 * two use sites and in that module's own tests, so "a match exists" would not mean it is the value
 * that ships. The pattern therefore requires the DECLARATION form (`: usize = …;`). A FUNCTION OVER
 * SOURCE TEXT rather than a file reader, so a test can feed crafted source and watch the refusal.
 *
 * The consumer is `src/themes/__tests__/stored-css-cap-parity.test.ts`.
 *
 * Same product-of-integers form as the two byte caps above, and for the same reason.
 */
export function storedThemeCssByteCap(rustSource: string): number {
  const literal = soleDeclaration(
    rustSource,
    /MAX_STORED_THEME_CSS_BYTES\s*:\s*usize\s*=\s*([0-9_ *]+);/gu,
    "MAX_STORED_THEME_CSS_BYTES",
  );
  return integerProduct(literal, "MAX_STORED_THEME_CSS_BYTES");
}

/**
 * The byte cap `MAX_THEME_MANIFEST_BYTES` applies to a staged theme's `baram-theme.json`.
 *
 * ‼️ ADDED BECAUSE THE PROSE CLAIMED THE PARITY AND NOTHING CHECKED IT (0090 final review,
 * N3). `src/themes/theme-install.ts` says of its own copy "Rust 도 staged 아카이브를 읽을
 * 때 같은 값으로 자른다" — a true sentence with no way to stay true. The two drifts are the
 * same silent pair the stored-CSS cap has: a frontend copy that drifted HIGHER lets a
 * manifest past the parse-cost bound and dies in Rust with a diagnosis about staging, and one
 * that drifted LOWER refuses manifests the backend would have read.
 *
 * ‼️ AND THIS ONE HAS A SECOND CONSUMER THE CSS CAP DOES NOT: `installTheme` is documented as
 * the ONLY gate for a caller that never went through an archive (spec §12.2's development
 * folder theme), so its number is load-bearing on its own rather than merely early.
 *
 * Same declaration-form requirement and product-of-integers parsing as the caps above, for
 * the reasons their comments give. The Rust type is `u64` here, not `usize` — transcribed
 * from `install.rs` at writing time, and the difference is why the pattern is not copied
 * verbatim from its neighbour.
 */
export function themeManifestByteCap(rustSource: string): number {
  const literal = soleDeclaration(
    rustSource,
    /MAX_THEME_MANIFEST_BYTES\s*:\s*u64\s*=\s*([0-9_ *]+);/gu,
    "MAX_THEME_MANIFEST_BYTES",
  );
  return integerProduct(literal, "MAX_THEME_MANIFEST_BYTES");
}

/**
 * §380 gate 5 — the largest plugin archive the app downloads, `MAX_PLUGIN_ARCHIVE_BYTES` in
 * `src-tauri/src/plugin/limits.rs`.
 *
 * ‼️ WHY SCRAPING RATHER THAN A SECOND LITERAL — the community gate should accept an archive
 * only if every client will download it. A copy that drifted HIGHER publishes entries every
 * install refuses at the byte cap; one that drifted LOWER refuses plugins the app installs.
 * Both are silent in a test that writes the same number on both sides.
 *
 * Same declaration form and product-of-integers parsing as the caps above. Its cross-language
 * anchor is `the_archive_bounds_are_the_numbers_the_community_gate_scrapes` in `limits.rs` —
 * a drift guard of the cap kind (literal against literal), not the key kind; see this file's
 * header for the difference.
 */
export function pluginArchiveByteCap(limitsSource: string): number {
  const literal = soleDeclaration(
    limitsSource,
    /\bMAX_PLUGIN_ARCHIVE_BYTES\s*:\s*usize\s*=\s*([0-9_ *]+);/gu,
    "MAX_PLUGIN_ARCHIVE_BYTES",
  );
  return integerProduct(literal, "MAX_PLUGIN_ARCHIVE_BYTES");
}

/**
 * §380 gate 6 — what a plugin archive must satisfy to pass §69's shared extraction core
 * (`extract_entry` in `src-tauri/src/fs/archive.rs`), read out of `limits.rs` where the app
 * declares them. That core's own header names SIX defences — entry count, per-entry size, total
 * size, compression ratio, path depth, and compression method — but the ratio defence alone
 * spans two constants (the ratio and its floor), which is why this interface has SEVEN fields.
 */
export interface PluginArchiveLimits {
  /** APPNOTE 4.4.5 method codes, from `ALLOWED_COMPRESSION` (0 = stored, 8 = deflated). */
  allowedMethods: readonly number[];
  maxCompressionRatio: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxPathDepth: number;
  maxTotalExpandedBytes: number;
  ratioFloorBytes: number;
}

/**
 * The APPNOTE codes of the `zip::CompressionMethod` variants `ALLOWED_COMPRESSION` names
 * today. ‼️ A variant missing here THROWS rather than being skipped: a skipped method would
 * make the gate refuse, silently, archives the app installs.
 *
 * ‼️ A `Map`, NOT A PLAIN OBJECT (M8, fix round 1). A compression method spelled
 * `constructor` — or any other name `Object.prototype` carries — must miss this lookup, not
 * silently resolve to a function `code === undefined` never catches.
 */
const ZIP_METHOD_CODES: ReadonlyMap<string, number> = new Map([
  ["Deflated", 8],
  ["Stored", 0],
]);

/**
 * §380 gate 6 — the seven values `limits.rs` declares for `fs::archive`'s six defences (entry
 * count, per-entry size, total size, compression ratio, path depth, compression method — the
 * ratio defence alone spans two constants), read out of the file where they are declared. The
 * gate enforces them on bytes actually read, the way `extract_entry` does.
 *
 * ‼️ THE COUNT ASSERTION IS LOAD-BEARING, but not for the reason an earlier draft of this
 * comment gave — that these names are ALSO used at their call site in
 * `src-tauri/src/plugin/archive.rs`. That is true but irrelevant here: this function's caller
 * passes `limits.rs`'s text ALONE, and a use site in a different file can never appear in it.
 * What a second declaration-form match WITHIN `limits.rs` itself would mean: a `#[cfg(test)]`
 * module shadowing one of these names with its own declaration, or a doc comment quoting an old
 * value in the declaration form (the decoy shape spelled out near `origin.rs`'s anchor). Each
 * pattern requires the DECLARATION form, so one match per identifier means the constant that
 * ships.
 *
 * ‼️ ALLOWED_COMPRESSION IS VALIDATED ELEMENT-BY-ELEMENT, not by a bare `CompressionMethod::(\w+)`
 * scan (I1, fix round 1): that scan matched text inside a line comment or a block comment
 * exactly as readily as live code, so commenting an entry out (leaving the array's declared
 * LENGTH stale, itself a compile error a developer would then "fix" by editing the length down)
 * left this function still reporting the commented-out method as allowed. Every non-empty,
 * comma-separated element of the captured body must match `zip::CompressionMethod::<Variant>`
 * exactly, or this throws naming the offending element — which a commented-out line never does.
 */
export function pluginArchiveLimits(limitsSource: string): PluginArchiveLimits {
  const bound = (name: string, type: "u64" | "usize"): number =>
    integerProduct(
      soleDeclaration(
        limitsSource,
        new RegExp(
          String.raw`\b${name}\s*:\s*${type}\s*=\s*([0-9_ *]+);`,
          "gu",
        ),
        name,
      ),
      name,
    );
  const methods = soleDeclaration(
    limitsSource,
    // ‼️ The body capture runs up to the first `];` (I1, fix round 1), not the first `]` —
    // `[^\]]*` would have truncated at a `]` written inside a comment inside the array, same
    // failure mode as the comment-reads-as-live defect this whole function now guards against.
    /\bALLOWED_COMPRESSION\s*:\s*\[zip::CompressionMethod;\s*\d+\]\s*=\s*\[([\s\S]*?)\]\s*;/gu,
    "ALLOWED_COMPRESSION",
  );
  const elements = methods
    .split(",")
    .map((element) => element.trim())
    .filter((element) => element.length > 0);
  if (elements.length === 0) {
    throw new Error(
      "ALLOWED_COMPRESSION parsed to an empty list — refusing to compare",
    );
  }
  const names = elements.map((element) => {
    const match = /^zip::CompressionMethod::(\w+)$/u.exec(element);
    if (!match) {
      throw new Error(
        `ALLOWED_COMPRESSION element ${JSON.stringify(element)} is not a ` +
          'bare "zip::CompressionMethod::<Variant>" — a comment, or any ' +
          "other spelling, is refused rather than silently dropped",
      );
    }
    return match[1];
  });
  return {
    allowedMethods: names.map((name) => {
      const code = ZIP_METHOD_CODES.get(name);
      if (code === undefined) {
        throw new Error(
          `no ZIP method code is known for CompressionMethod::${name} — add it to ZIP_METHOD_CODES deliberately`,
        );
      }
      return code;
    }),
    maxCompressionRatio: bound("MAX_COMPRESSION_RATIO", "u64"),
    maxEntries: bound("MAX_ARCHIVE_ENTRIES", "usize"),
    maxEntryBytes: bound("MAX_ENTRY_BYTES", "u64"),
    maxPathDepth: bound("MAX_PATH_DEPTH", "usize"),
    maxTotalExpandedBytes: bound("MAX_TOTAL_EXPANDED_BYTES", "u64"),
    ratioFloorBytes: bound("RATIO_FLOOR_BYTES", "u64"),
  };
}

/**
 * §380 gate 6 — the byte cap `MAX_README_BYTES` the app refuses to fetch a listing's README
 * past (`fetch_capped_text_with` in `src-tauri/src/plugin/fetch.rs`, returning `"{what} too
 * large: exceeds {cap} byte limit"`).
 *
 * ‼️ WHY SCRAPING RATHER THAN A SECOND LITERAL — an archive whose README exceeds this cap
 * would publish through the community gate and then never render: the app's own fetch refuses
 * it before `MarkdownRenderer` ever sees the bytes. A copy of the number here could drift from
 * the one enforced, and the drift is silent in a test that writes the same number on both
 * sides.
 *
 * Paired with `MAX_README_BYTES` in `src/components/plugins/plugin-readme.ts` — that copy caps
 * the INSTALLED copy and, per its own comment, truncates what is rendered rather than
 * refusing; do not read this function's refusal as covering that path too.
 * `src/plugins/__tests__/registry-readme-cap.test.ts` already fails if the Rust and that TS
 * copy part. Its cross-language anchor is
 * `the_readme_cap_is_the_number_the_community_gate_scrapes` in `fetch.rs`.
 *
 * Same declaration form and product-of-integers parsing as the caps above.
 */
export function readmeByteCap(fetchSource: string): number {
  const literal = soleDeclaration(
    fetchSource,
    /\bMAX_README_BYTES\s*:\s*usize\s*=\s*([0-9_ *]+);/gu,
    "MAX_README_BYTES",
  );
  return integerProduct(literal, "MAX_README_BYTES");
}

/**
 * §385 — the byte cap `MAX_SANDBOX_REPORT_BYTES` Rust applies to one sandbox→host report
 * (`src-tauri/src/commands/plugin_cmd.rs`). The prompt pre-check measures against the TS copy
 * in `src/plugins/sandbox/protocol.ts`; a copy that drifted HIGHER lets through a frame Rust
 * drops unanswered — the silent 150 s wait the pre-check exists to prevent.
 *
 * Declaration form and product-of-integers parsing, as the caps above. The consumer is
 * `src/plugins/sandbox/__tests__/report-cap-parity.test.ts`.
 */
export function sandboxReportByteCap(rustSource: string): number {
  const literal = soleDeclaration(
    rustSource,
    /MAX_SANDBOX_REPORT_BYTES\s*:\s*usize\s*=\s*([0-9_ *]+);/gu,
    "MAX_SANDBOX_REPORT_BYTES",
  );
  return integerProduct(literal, "MAX_SANDBOX_REPORT_BYTES");
}

/**
 * A Rust byte-cap literal written as a product of integers (`4 * 1024 * 1024`), as a number.
 *
 * ‼️ ONE IMPLEMENTATION, NOT FOUR (external review #7). Each of the four scrapers above
 * carried a byte-identical copy of this reduce, differing only in the identifier inside the
 * throw — so it is passed in. The *patterns* legitimately differ (`usize` vs `u64`, and
 * `themeManifestByteCap`'s doc comment says so); the parsing of what they capture does not.
 *
 * Anything but a product of positive safe integers throws rather than being read as a
 * smaller number: the callers use the result as a publish-time bound, and a value silently
 * read as `0` or `NaN` would refuse everything or nothing.
 */
function integerProduct(literal: string, constant: string): number {
  return literal.split("*").reduce((product, part) => {
    const value = Number(part.replaceAll("_", "").trim());
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`cannot read ${constant}: "${literal.trim()}"`);
    }
    return product * value;
  }, 1);
}

/** Exactly one declaration must match, or we are guessing which value ships. */
function soleDeclaration(
  rustSource: string,
  pattern: RegExp,
  identifier: string,
): string {
  const declarations = [...rustSource.matchAll(pattern)];
  if (declarations.length !== 1) {
    throw new Error(
      `found ${declarations.length} declarations of ${identifier} — refusing to guess which one ships`,
    );
  }
  return declarations[0][1];
}

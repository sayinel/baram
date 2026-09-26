/**
 * Read constants the APP compiled in, out of the Rust that enforces them (§69).
 *
 * ‼️ WHY SCRAPING RATHER THAN A SECOND LITERAL. Two of the publish gate's decisions are only
 * meaningful against what a CLIENT will do: which key it verifies with, and how many bytes it will
 * fetch. A copy of either number here would be a value that can drift from the one enforced, and
 * both drifts are silent — a stale key verifies nothing users hold, and a stale cap publishes a
 * document no client can read. So the gate reads Rust.
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
 * ‼️ THE COUNT IS NOT THE WHOLE DEFENCE, AND THE THREE SCRAPES THIS FILE MAKES FOR THE PUBLISH
 * GATE — THE KEY, THE REVOCATION CAP, AND THE REGISTRY CAP — ARE NOT EQUALLY PROTECTED. The first
 * version of this header implied a single cap and equal protection for both scrapes it named
 * (security review NEW-2); the registry cap is a second instance of the weaker kind, not a third
 * kind. Counting stops a declaration being ADDED; it cannot stop the real one being respelled past
 * the pattern while a decoy comment keeps the count at 1. What closes that is a CROSS-LANGUAGE
 * ANCHOR — an assertion on the compiled value that goes red when the scraped value drifts from it:
 *
 * - the key has one: vitest binds the scraped key to the frozen at-arming pair and
 *   `mod.rs`'s own test binds the compiled key to the same two files, so a divergence is
 *   self-contradictory in both directions.
 * - the caps have WEAKER ones, the same shape at both:
 *   `the_fetch_cap_is_the_number_the_publish_gate_scrapes` in `origin.rs` (MAX_REVOCATION_BYTES) and
 *   `the_registry_cap_is_the_number_the_publish_gate_scrapes` in `fetch.rs` (MAX_REGISTRY_BYTES).
 *   Without the first, `const MAX_REVOCATION_BYTES: usize = ONE_MIB;` plus a decoy comment in the
 *   matched form left this returning 1 MiB while clients capped at whatever `ONE_MIB` said — and an
 *   oversized list then publishes green and no client can read it.
 *
 * ‼️ THE KEY'S ANCHOR AND THE CAPS' ANCHORS ARE NOT THE SAME STRENGTH, and calling them "the same
 * discipline" flattened a real difference (third-round security review Q4/L-1). The key's anchor is
 * a SIGNATURE: unforgeable without the private half, and red in both directions. Each cap's is a
 * NUMBER asserted against a hand-written literal on each side — neither assertion compares scraped
 * against compiled, both compare against a constant a commit can edit. A reviewer measured the cost
 * of defeating one: the decoy, the indirection, and ONE literal edit in the Rust test. So each is a
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

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
 * ‼️ THE COUNT IS NOT THE WHOLE DEFENCE, AND THE TWO SCRAPES ARE NOT EQUALLY PROTECTED — the first
 * version of this header implied they were (security review NEW-2). Counting stops a declaration
 * being ADDED; it cannot stop the real one being respelled past the pattern while a decoy comment
 * keeps the count at 1. What closes that is a CROSS-LANGUAGE ANCHOR — an assertion on the compiled
 * value that goes red when the scraped value drifts from it:
 *
 * - the key has one: vitest binds the scraped key to the frozen at-arming pair and
 *   `mod.rs`'s own test binds the compiled key to the same two files, so a divergence is
 *   self-contradictory in both directions.
 * - the cap has a WEAKER one: `the_fetch_cap_is_the_number_the_publish_gate_scrapes` in `mod.rs`.
 *   Without it, `const MAX_REVOCATION_BYTES: usize = ONE_MIB;` plus a decoy comment in the matched
 *   form left this returning 1 MiB while clients capped at whatever `ONE_MIB` said — and an
 *   oversized list then publishes green and no client can read it.
 *
 * ‼️ THE TWO ANCHORS ARE NOT THE SAME STRENGTH, and calling them "the same discipline" flattened a
 * real difference (third-round security review Q4/L-1). The key's anchor is a SIGNATURE: unforgeable
 * without the private half, and red in both directions. The cap's is a NUMBER asserted against a
 * hand-written literal on each side — neither assertion compares scraped against compiled, both
 * compare against a constant a commit can edit. A reviewer measured the cost of defeating it: the
 * decoy, the indirection, and ONE literal edit in the Rust test. So it is a DRIFT GUARD, and its
 * value is that the diff is unmissable — a new `const ONE_MIB` beside a re-pointed constant and a
 * changed assertion literal is not something a reviewer reads past.
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
  return literal.split("*").reduce((product, part) => {
    const value = Number(part.replaceAll("_", "").trim());
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`cannot read MAX_REVOCATION_BYTES: "${literal.trim()}"`);
    }
    return product * value;
  }, 1);
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
  const extensions = [...body.matchAll(/\(\s*"([^"]+)"\s*,\s*"[^"]+"\s*\)/gu)].map(
    (m) => m[1],
  );
  if (extensions.length === 0) {
    throw new Error("MEDIA_MIME_TYPES parsed to an empty table — refusing to compare");
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
  return literal.split("*").reduce((product, part) => {
    const value = Number(part.replaceAll("_", "").trim());
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`cannot read MAX_INLINE_MEDIA_BYTES: "${literal.trim()}"`);
    }
    return product * value;
  }, 1);
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
  return signature
    .split(",")
    .map((part) => part.split(":")[0].trim())
    .filter((name) => name.length > 0 && name !== "app");
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

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

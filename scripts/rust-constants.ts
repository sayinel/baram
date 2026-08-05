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

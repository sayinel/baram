// §69 — the README size cap, which exists twice and must be one number.
//
// `plugin-readme.ts` caps the INSTALLED copy, read off disk; `fetch.rs` caps the LISTING's
// copy, fetched from the registry. They render through the same `MarkdownRenderer` call on
// the same screen, so bounds that drifted would mean the same document was legible on one
// side of an install and truncated on the other — and nothing would report it, because
// truncation is what both are supposed to do.
//
// ‼️ SCRAPED, NOT RESTATED, for the reason `scripts/rust-constants.ts` gives at length: a
// third copy of the number here would be one more thing to drift, and this file would then
// pass while both of the values that ship disagreed.
//
// ‼️ AND THE MATCH COUNT IS ASSERTED. The identifier also appears in prose in both files, so
// "a declaration matched" is not "the declaration that ships matched" — the same mistake
// `rust-constants.ts` records this feature making four times.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RUST = resolve(__dirname, "../../../src-tauri/src/plugin/fetch.rs");
const TS = resolve(__dirname, "../../components/plugins/plugin-readme.ts");

/**
 * Evaluate a Rust/TS integer expression limited to digits, `_`, `*` and spaces.
 *
 * Deliberately not `eval` and deliberately not a plain `Number(...)`: the declarations are
 * written `256 * 1024`, and a parser that accepted more than this charset would be a way to
 * run whatever a future edit put there.
 */
function evaluate(expression: string): number {
  if (!/^[\d_ *]+$/u.test(expression)) {
    throw new Error(`refusing to evaluate ${JSON.stringify(expression)}`);
  }
  return expression
    .split("*")
    .map((part) => Number(part.replace(/[_ ]/gu, "")))
    .reduce((a, b) => a * b, 1);
}

/** Every declaration of `MAX_README_BYTES` in `source`, as evaluated numbers. */
function declarationsIn(source: string, pattern: RegExp): number[] {
  return [...source.matchAll(pattern)].map((m) => evaluate(m[1]));
}

describe("the README cap is one number in two languages (§69)", () => {
  const rustDeclarations = declarationsIn(
    readFileSync(RUST, "utf8"),
    /const\s+MAX_README_BYTES\s*:\s*usize\s*=\s*([^;]+);/gu,
  );
  const tsDeclarations = declarationsIn(
    readFileSync(TS, "utf8"),
    /export\s+const\s+MAX_README_BYTES\s*=\s*([^;]+);/gu,
  );

  it("finds exactly one declaration on each side", () => {
    // A second declaration is the failure this guards: bash and serde both take the LAST
    // one, so an added decoy changes what ships while a `.includes` check stays green.
    expect(rustDeclarations, `in ${RUST}`).toHaveLength(1);
    expect(tsDeclarations, `in ${TS}`).toHaveLength(1);
  });

  it("agrees across the two", () => {
    expect(rustDeclarations[0]).toBe(tsDeclarations[0]);
  });

  it("is a real bound, not a placeholder", () => {
    // ‼️ WHAT THIS DOES *NOT* PROVE, said out loud: that either cap is ENFORCED. Rust's is,
    // streamed, before the bytes are buffered; the TypeScript one is applied to a string
    // that is already in memory, which its own comment states. This test is about the two
    // agreeing, and a reader must not take it for coverage of the enforcement.
    expect(rustDeclarations[0]).toBeGreaterThan(0);
  });
});

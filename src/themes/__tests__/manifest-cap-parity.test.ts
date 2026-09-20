// §360 / 0090 final review (N3) — the theme manifest byte cap is one number.
//
// `theme-install.ts`'s `MAX_THEME_MANIFEST_BYTES` doc comment has always claimed the parity
// ("Rust 도 staged 아카이브를 읽을 때 같은 값으로 자른다") and nothing checked it. Same
// silent pair as the stored-CSS cap: a frontend copy that drifted HIGHER lets a manifest
// past the parse-cost bound and dies in Rust with a message about staging; one that drifted
// LOWER refuses manifests the backend would have read, with nothing to name the real limit.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { themeManifestByteCap } from "../../../scripts/rust-constants";
import {
  MAX_THEME_MANIFEST_BYTES,
  parseThemeManifestText,
} from "../theme-install";

/** By literal path, and `soleDeclaration` throws on zero matches — so moving the constant
 *  turns this red rather than passing vacuously (CLAUDE.md's warning about path scans). */
const INSTALL_RS = resolve(
  __dirname,
  "../../../src-tauri/src/plugin/install.rs",
);

describe("the theme manifest cap is one number", () => {
  it("matches the value Rust compiles in", () => {
    const compiled = themeManifestByteCap(readFileSync(INSTALL_RS, "utf8"));
    expect(MAX_THEME_MANIFEST_BYTES).toBe(compiled);
  });

  it("reads the declaration and refuses to guess when there is not exactly one", () => {
    // Non-vacuity, the same three probes the stored-CSS parity test uses: the scrape must
    // read the DECLARATION, not any mention, or the assertion above measures the wrong text.
    expect(
      themeManifestByteCap("const MAX_THEME_MANIFEST_BYTES: u64 = 64 * 1024;"),
    ).toBe(64 * 1024);
    expect(() =>
      themeManifestByteCap("if size > MAX_THEME_MANIFEST_BYTES {"),
    ).toThrow(/found 0 declarations/u);
    expect(() =>
      themeManifestByteCap(
        "const MAX_THEME_MANIFEST_BYTES: u64 = 1;\nconst MAX_THEME_MANIFEST_BYTES: u64 = 2;",
      ),
    ).toThrow(/found 2 declarations/u);
  });

  // ‼️ THE UNIT, NOT ONLY THE NUMBER — the same trap the stored-CSS cap documents. Rust
  // measures bytes; `String.length` is UTF-16 code units, and "가" is one unit and three
  // bytes. A frontend that measured characters would be the LOOSER gate at an identical
  // number. This pins the unit without building a 64 KiB fixture.
  it("measures the manifest in UTF-8 bytes, like Rust", () => {
    const overByBytes = `{"name":"${"가".repeat(MAX_THEME_MANIFEST_BYTES / 3)}"}`;
    expect(overByBytes.length).toBeLessThan(MAX_THEME_MANIFEST_BYTES);
    const result = parseThemeManifestText(overByBytes);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors[0].message).toContain(
      "over the",
    );
  });
});

// ‼️ External review #7 — the integer-product parser was four byte-identical copies, one
// per scraper, differing only in the identifier inside the throw. They are one helper now,
// and this is the only place that exercises its refusal: every other test feeds it a real
// declaration, so a helper that stopped refusing would have stayed green everywhere.
//
// The refusal matters because the callers use the result as a publish-time bound. A literal
// read as `NaN` or `0` — which is what dropping the guard produces — would make the gate
// refuse everything or nothing, silently, on a number nobody looks at twice.
describe("the shared integer-product parser refuses what it cannot read", () => {
  const declare = (literal: string) =>
    `const MAX_THEME_MANIFEST_BYTES: u64 = ${literal};`;

  // ‼️ ONLY INPUTS THAT REACH THE PARSER. The capture class is `[0-9_ *]+`, so a float or a
  // negative never matches the declaration at all and `soleDeclaration` refuses first with
  // "found 0 declarations" — a different gate, pinned below. What gets THROUGH the pattern
  // and still has to be refused is a zero, an empty factor, and a magnitude past
  // `Number.MAX_SAFE_INTEGER`.
  it.each([
    ["a zero factor", "64 * 0"],
    ["an empty factor", "64 * "],
    ["a value past the safe-integer range", "9007199254740993"],
  ])("throws on %s", (_label, literal) => {
    expect(() => themeManifestByteCap(declare(literal))).toThrow(
      /cannot read MAX_THEME_MANIFEST_BYTES/u,
    );
  });

  it.each([
    ["a float", "64.5 * 1024"],
    ["a negative", "-64 * 1024"],
  ])(
    "refuses %s at the pattern, before the parser sees it",
    (_label, literal) => {
      // Recorded rather than assumed: the two layers refuse different things, and a reader
      // who saw only the cases above would think the parser handles these.
      expect(() => themeManifestByteCap(declare(literal))).toThrow(
        /found 0 declarations/u,
      );
    },
  );

  it("names the constant it was reading", () => {
    // The identifier is the only thing the four copies differed by, so it is the thing a
    // shared helper could lose. A caller staring at "cannot read" with no name has to go
    // find which of four caps failed.
    expect(() => themeManifestByteCap(declare("64 * 0"))).toThrow(
      /cannot read MAX_THEME_MANIFEST_BYTES/u,
    );
  });

  it("still reads underscores and plain products", () => {
    // The anchor: the guard must not have become "throw on everything".
    expect(themeManifestByteCap(declare("64 * 1_024"))).toBe(64 * 1024);
    expect(themeManifestByteCap(declare("65536"))).toBe(65536);
  });
});

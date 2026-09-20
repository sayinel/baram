// §360 — the stored-CSS cap is enforced in Rust and refused earlier in TypeScript. This
// binds the two so neither can move alone.
//
// ‼️ WHY THE SCRAPE RATHER THAN TWO LITERALS: both drifts are silent. A frontend copy that
// drifted HIGHER lets a theme through the whole hygiene pipeline and kills it at the commit
// with a diagnosis about staging; one that drifted LOWER refuses themes the backend would
// have stored, with nothing to tell the author what the real limit is. `rust-constants.ts`
// documents the general form of this argument, and `soleDeclaration` is why a respelled or
// duplicated declaration throws instead of returning a plausible number.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { storedThemeCssByteCap } from "../../../scripts/rust-constants";
import {
  MAX_STORED_THEME_CSS_BYTES,
  storedCssByteLength,
} from "../theme-install";

/**
 * The file the constant lives in, by literal path.
 *
 * Moving the constant elsewhere does not silently disarm this: `soleDeclaration` throws on
 * zero matches, so the test goes red rather than green (CLAUDE.md's "리터럴 경로 스캔
 * 테스트" warning is about scans that would pass vacuously — this one cannot).
 */
const INSTALL_RS = resolve(
  __dirname,
  "../../../src-tauri/src/plugin/install.rs",
);

describe("the stored theme CSS cap is one number (§360)", () => {
  it("matches the value Rust compiles in", () => {
    const compiled = storedThemeCssByteCap(readFileSync(INSTALL_RS, "utf8"));
    expect(MAX_STORED_THEME_CSS_BYTES).toBe(compiled);
  });

  // Non-vacuity: the scrape reads the DECLARATION, not any mention. Without this, a
  // pattern loose enough to match a use site or a comment would still make the assertion
  // above pass while measuring the wrong text.
  it("reads the declaration and refuses to guess when there is not exactly one", () => {
    expect(
      storedThemeCssByteCap(
        "const MAX_STORED_THEME_CSS_BYTES: usize = 4 * 1024 * 1024;",
      ),
    ).toBe(4 * 1024 * 1024);
    expect(() =>
      storedThemeCssByteCap(
        "read_text_capped(&p, MAX_STORED_THEME_CSS_BYTES as u64)",
      ),
    ).toThrow(/found 0 declarations/u);
    expect(() =>
      storedThemeCssByteCap(
        "const MAX_STORED_THEME_CSS_BYTES: usize = 1;\nconst MAX_STORED_THEME_CSS_BYTES: usize = 2;",
      ),
    ).toThrow(/found 2 declarations/u);
  });

  // ‼️ THE UNIT, NOT ONLY THE NUMBER. Rust's `body.len()` is UTF-8 BYTES; JavaScript's
  // `String.length` is UTF-16 CODE UNITS. "가" is one code unit and three bytes, so a
  // frontend measuring with `.length` would be the LOOSER of the two caps while both
  // constants read `4 * 1024 * 1024` — a drift the value assertion above cannot see,
  // because the value never moved. Asserting the measurement instead of the threshold is
  // what makes this cheap: it needs one character rather than a 4 MiB document.
  it("measures in the same unit Rust does", () => {
    expect(storedCssByteLength("가")).toBe(3);
    expect(storedCssByteLength("가")).not.toBe("가".length);
    expect(storedCssByteLength("ab")).toBe(2);
  });

  // ‼️ The cap must sit ABOVE what a package respecting the other two caps can produce, or
  // it fires first on honest themes and the author is told the wrong thing. The arithmetic
  // is in the Rust constant's comment; this is that arithmetic, executable.
  it("leaves room for a theme that respects the asset and stylesheet caps", async () => {
    const { MAX_THEME_ASSET_BYTES } =
      await import("../../utils/theme-css/inline-assets");
    const { MAX_THEME_CSS_BYTES } = await import("../theme-store-fs");
    const base64 = Math.ceil(MAX_THEME_ASSET_BYTES / 3) * 4;
    expect(base64 + MAX_THEME_CSS_BYTES).toBeLessThan(
      MAX_STORED_THEME_CSS_BYTES,
    );
  });
});

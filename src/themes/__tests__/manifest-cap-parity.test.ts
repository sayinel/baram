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

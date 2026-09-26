// §379 — every refusal code Rust can send has words in both catalogues.
//
// ‼️ A literal path scan, like `approval-error-codes.test.ts`: moving `dev_mode.rs` compiles
// fine and silently kills this check. Move the path with it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { devModeErrorCodes } from "../../../scripts/rust-constants";
import en from "../../i18n/en.json";
import ko from "../../i18n/ko.json";
import { describeDevError } from "../plugin-dev-errors";

const DEV_MODE_RS = join(process.cwd(), "src-tauri/src/plugin/dev_mode.rs");
const codes = devModeErrorCodes(readFileSync(DEV_MODE_RS, "utf8"));
const EN = en as Record<string, string>;
const KO = ko as Record<string, string>;

describe("§379 developer-mode error codes (TS ↔ Rust)", () => {
  it("the scrape read all nine declarations", () => {
    expect(codes.size).toBe(9);
  });

  it("every Rust code turns into a key both catalogues translate", () => {
    for (const code of codes.values()) {
      const key = describeDevError(code, (k) => k);
      expect(key, code).toMatch(/^plugin\.dev\.error\./u);
      expect(EN[key], key).toBeTruthy();
      expect(KO[key], key).toBeTruthy();
    }
  });

  it("anything else passes through as it came — Rust's own messages stay visible", () => {
    expect(describeDevError("Invalid manifest: id is required", (k) => k)).toBe(
      "Invalid manifest: id is required",
    );
    expect(describeDevError(new Error("disk on fire"), (k) => k)).toBe(
      "disk on fire",
    );
    // A prototype key is not a code.
    expect(describeDevError("constructor", (k) => k)).toBe("constructor");
  });

  it("refuses to guess when a declaration is doubled or missing", () => {
    expect(() =>
      devModeErrorCodes(`
        pub const DEV_MODE_INACTIVE: &str = "A";
        pub const DEV_MODE_INACTIVE: &str = "B";
      `),
    ).toThrow(/found 2 declarations of DEV_MODE_INACTIVE/u);
    expect(() =>
      devModeErrorCodes(`pub const STORE_FILE: &str = "x";`),
    ).toThrow(/no DEV_ error codes/u);
  });
});

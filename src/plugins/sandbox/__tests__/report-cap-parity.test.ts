// §385 spec 0061 §9 — the sandbox pre-check measures a frame against the TS copy of Rust's
// report cap. A copy that drifted HIGHER lets through a frame Rust then drops unanswered.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { sandboxReportByteCap } from "../../../../scripts/rust-constants";
import { MAX_SANDBOX_REPORT_BYTES } from "../protocol";

/** By literal path; `soleDeclaration` throws on zero matches, so moving the constant turns this red. */
const PLUGIN_CMD_RS = resolve(
  __dirname,
  "../../../../src-tauri/src/commands/plugin_cmd.rs",
);

describe("the sandbox report cap is one number", () => {
  it("matches the value Rust compiles in", () => {
    expect(MAX_SANDBOX_REPORT_BYTES).toBe(
      sandboxReportByteCap(readFileSync(PLUGIN_CMD_RS, "utf8")),
    );
  });

  it("reads the declaration and refuses to guess when there is not exactly one", () => {
    expect(
      sandboxReportByteCap(
        "const MAX_SANDBOX_REPORT_BYTES: usize = 8 * 1024 * 1024;",
      ),
    ).toBe(8 * 1024 * 1024);
    expect(() =>
      sandboxReportByteCap("if len > MAX_SANDBOX_REPORT_BYTES {"),
    ).toThrow(/found 0 declarations/u);
    expect(() =>
      sandboxReportByteCap(
        "const MAX_SANDBOX_REPORT_BYTES: usize = 1;\nconst MAX_SANDBOX_REPORT_BYTES: usize = 2;",
      ),
    ).toThrow(/found 2 declarations/u);
  });
});

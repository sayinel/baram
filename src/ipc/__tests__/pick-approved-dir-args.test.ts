// Cross-language guard — the keys the TS wrapper sends must be the parameters the Rust command
// declares.
//
// This exists because the drift is silent in both directions. Tauri converts camelCase payload
// keys to snake_case parameters; a key no parameter matches is DROPPED, with no type error (the
// wrapper compiles) and no runtime error (the command runs). `start_dir` then arrives as `None`,
// and `None` means "open wherever the OS last was" — indistinguishable, from the outside, from the
// picker working. A missing key is a feature that never happens rather than a failure anyone sees.
//
// ‼️ Literal path scan — moving `pick_approved_dir` to another file leaves this reading a file that
// no longer declares it, and the scrape refuses rather than passing. Update the path when it moves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickApprovedDirParams } from "../../../scripts/rust-constants";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

const { pickApprovedDir } = await import("../approval");

const params = pickApprovedDirParams(
  readFileSync(
    join(process.cwd(), "src-tauri/src/commands/approval_cmd.rs"),
    "utf8",
  ),
);

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/gu, (_, c: string) => c.toUpperCase());
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(null);
});

describe("pick_approved_dir arguments (TS ↔ Rust)", () => {
  it("sends exactly the keys Rust declares", async () => {
    await pickApprovedDir("journal", "/Users/someone/Notes/journal");

    // ‼️ `toHaveBeenCalledWith` is blind to a key present with an undefined value, which is the
    // shape a wrapper produces when the caller omits an optional argument. Comparing the actual
    // object is what makes an extra or misspelled key visible.
    expect(Object.keys(invoke.mock.calls[0][1] as object).sort()).toStrictEqual(
      params.map(toCamel).sort(),
    );
  });

  it("carries the start directory through under that name", async () => {
    await pickApprovedDir("journal", "/Users/someone/Notes/journal");

    expect(invoke.mock.calls[0][1]).toStrictEqual({
      purpose: "journal",
      startDir: "/Users/someone/Notes/journal",
    });
  });

  it("distinguishes 'no preference' from 'nothing is set'", async () => {
    // Two different requests to Rust: undefined leaves the OS's last folder alone, "" asks for the
    // home directory. Collapsing them would take the remembered folder away from "Add Folder…".
    await pickApprovedDir("open-folder");
    await pickApprovedDir("journal", "");

    expect(invoke.mock.calls[0][1]).toStrictEqual({
      purpose: "open-folder",
      startDir: undefined,
    });
    expect(invoke.mock.calls[1][1]).toStrictEqual({
      purpose: "journal",
      startDir: "",
    });
  });

  it("actually read the signature, so the comparison above is not empty", () => {
    expect(params).toStrictEqual(["purpose", "start_dir"]);
  });

  it("refuses a signature it cannot actually parse", () => {
    // The scrape splits on every comma, so a parameter whose TYPE carries one would be read as
    // two — one of them a fragment. Silently returning that list would have the check above
    // comparing the payload against nonsense and passing or failing for the wrong reason.
    expect(() =>
      pickApprovedDirParams(
        `pub async fn pick_approved_dir<R: tauri::Runtime>(app: A, purpose: String, retry: Option<Result<u8, String>>) -> X {}`,
      ),
    ).toThrow(/the signature parse broke/u);
  });

  it("refuses to guess when the declaration is not unique", () => {
    expect(() =>
      pickApprovedDirParams(`
        pub async fn pick_approved_dir<R: tauri::Runtime>(app: A, purpose: String) -> X {}
        pub async fn pick_approved_dir<R: tauri::Runtime>(app: A, other: String) -> X {}
      `),
    ).toThrow(/found 2 declarations of pick_approved_dir/u);
    expect(() => pickApprovedDirParams("// nothing here")).toThrow(
      /found 0 declarations of pick_approved_dir/u,
    );
  });
});

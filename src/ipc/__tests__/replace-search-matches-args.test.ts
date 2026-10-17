// §5.11 Cross-language guard — the keys `replaceSearchMatches` sends must be the parameters
// `replace_search_matches` declares. Tauri looks each parameter up under its camelCase name and
// ignores a payload key no parameter looks up; an `Option` parameter whose key is absent arrives
// as `None`. `options` is one: a misnamed `options` key would replace with the default options,
// not the panel's toggles. `target` is required, so a misnamed one is refused — this test says which
// side drifted. The Rust side sends a payload with the same keys through the IPC dispatcher
// (`replace_search_matches_takes_the_payload_the_panel_sends` in `search_cmd.rs`).
//
// ‼️ Literal path scan — moving `replace_search_matches` out of `search_cmd.rs` leaves this reading
// a file that no longer declares it, and the scrape refuses rather than passing.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { replaceSearchMatchesParams } from "../../../scripts/rust-constants";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

const { replaceSearchMatches } = await import("../search");

const params = replaceSearchMatchesParams(
  readFileSync(
    join(process.cwd(), "src-tauri/src/commands/search_cmd.rs"),
    "utf8",
  ),
);

function toCamel(snake: string): string {
  return snake.replace(/_([a-z])/gu, (_, c: string) => c.toUpperCase());
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue("replaced");
});

describe("replace_search_matches arguments (TS ↔ Rust)", () => {
  it("sends exactly the keys Rust declares", async () => {
    await replaceSearchMatches("a a", "a", { wholeWord: true }, "X", {
      column: 3,
      kind: "one",
      line: 1,
    });

    // ‼️ Comparing the keys of the actual object, not `toHaveBeenCalledWith`, which is blind to a
    // key present with an undefined value.
    expect(invoke.mock.calls[0][0]).toBe("replace_search_matches");
    expect(Object.keys(invoke.mock.calls[0][1] as object).sort()).toStrictEqual(
      params.map(toCamel).sort(),
    );
  });

  it("carries the panel's text, query, options, replacement and target under those names", async () => {
    const replaced = await replaceSearchMatches(
      "a a",
      "a",
      { regex: true },
      "X",
      { kind: "all" },
    );

    expect(replaced).toBe("replaced");
    expect(invoke.mock.calls[0][1]).toStrictEqual({
      content: "a a",
      options: { regex: true },
      query: "a",
      replacement: "X",
      target: { kind: "all" },
    });
  });

  it("actually read the signature, so the comparison above is not empty", () => {
    expect(params).toStrictEqual([
      "content",
      "query",
      "options",
      "replacement",
      "target",
    ]);
  });
});

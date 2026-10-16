// §394 spec 0073 D4 · D5 · §4 · §7 — `contributions.codeBlocks` and the `codeblocks` capability.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { validateManifest } from "../manifest";
import {
  BUILTIN_CODE_BLOCK_LANGS,
  declaredCodeBlockLangs,
  MAX_CODE_BLOCKS,
} from "../manifest-code-blocks";

const BASE = {
  author: "a",
  description: "d",
  engines: { baram: ">=0.7.7" },
  id: "p",
  license: "MIT",
  main: "dist/index.mjs",
  name: "P",
  trust: "sandboxed",
  version: "1.0.0",
};

function errors(capabilities: string[], codeBlocks?: unknown): string[] {
  const result = validateManifest({
    ...BASE,
    capabilities,
    ...(codeBlocks === undefined ? {} : { contributions: { codeBlocks } }),
  });
  return result.valid
    ? []
    : result.errors.map((e) => `${e.field}: ${e.message}`);
}

describe("contributions.codeBlocks", () => {
  /** The positive row every refusal below is paired with. */
  it("accepts declared languages with the capability", () => {
    expect(
      errors(["codeblocks"], [{ lang: "backlinks" }, { lang: "chart-v2" }]),
    ).toEqual([]);
  });

  /** What fails this: a lang rule looser than `^[a-z0-9][a-z0-9-]{0,31}$`. */
  it.each(["Backlinks", "-x", "a_b", "a.b", "", "x".repeat(33), "한글"])(
    "refuses the name %j",
    (lang) => {
      expect(errors(["codeblocks"], [{ lang }]).join("\n")).toMatch(
        /codeBlocks\[0\]\.lang/,
      );
    },
  );

  /** D5 — Baram's own branches and every highlighted name (aliases too) are refused. */
  it.each([
    "mermaid",
    "query",
    "svg",
    "journal-day",
    "js",
    "python",
    "md",
    "yml",
  ])("refuses %s, which Baram already draws or highlights", (lang) => {
    expect(errors(["codeblocks"], [{ lang }]).join("\n")).toMatch(
      /codeBlocks\[0\]\.lang/,
    );
  });

  it("refuses a duplicate and more than the cap", () => {
    expect(
      errors(["codeblocks"], [{ lang: "x" }, { lang: "x" }]).join("\n"),
    ).toMatch(/duplicate/);
    const many = Array.from({ length: MAX_CODE_BLOCKS + 1 }, (_, i) => ({
      lang: `l${i}`,
    }));
    expect(errors(["codeblocks"], many).join("\n")).toMatch(
      new RegExp(`at most ${MAX_CODE_BLOCKS}`),
    );
  });

  /** §4 — the capability and the declaration come together or not at all. */
  it("refuses a declaration without the capability and the capability without a declaration", () => {
    expect(errors([], [{ lang: "x" }]).join("\n")).toMatch(
      /"codeblocks" capability/,
    );
    expect(errors(["codeblocks"]).join("\n")).toMatch(
      /contributions\.codeBlocks/,
    );
    expect(errors(["codeblocks"], []).join("\n")).toMatch(
      /contributions\.codeBlocks/,
    );
  });

  /** The built-in branches are the parse-time `CODE_LANG_MAP` of `md-to-pm.ts` (plus the
   *  `journal-` NodeView prefix). What fails this: a fourth parse-time branch added there and not
   *  here — a plugin could then claim a language Baram renders itself. */
  it("lists exactly the parse-time branches of md-to-pm.ts", () => {
    const source = readFileSync(
      resolve(__dirname, "../../pipeline/md-to-pm.ts"),
      "utf8",
    );
    const map = source.slice(
      source.indexOf("const CODE_LANG_MAP"),
      source.indexOf("] as const;"),
    );
    const langs = [...map.matchAll(/lang: "([^"]+)"/gu)].map((m) => m[1]);
    expect(langs.length).toBeGreaterThanOrEqual(3);
    expect([...BUILTIN_CODE_BLOCK_LANGS].sort()).toEqual(langs.sort());
  });
});

describe("declaredCodeBlockLangs", () => {
  /** What fails this: returning languages for a manifest without the capability — a narrowed
   *  consent would still claim them (Task 9). */
  it("is sorted and unique with the capability, and empty without it", () => {
    const contributions = { codeBlocks: [{ lang: "b" }, { lang: "a" }] };
    expect(
      declaredCodeBlockLangs({ capabilities: ["codeblocks"], contributions }),
    ).toEqual(["a", "b"]);
    expect(declaredCodeBlockLangs({ capabilities: [], contributions })).toEqual(
      [],
    );
  });
});

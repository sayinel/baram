// §298 Vim Phase 1 — the core's purity is a load-bearing constraint, not a
// style preference (design §2: "순수 상태머신, PM import 0").
//
// If ProseMirror leaks in here the modal logic stops being testable without a
// document, and the adapters lose the seam that keeps positions in one place.
// A convention nobody checks is a convention that erodes, so check it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_DIR = join(import.meta.dirname, "..");
const FORBIDDEN = /from\s+["'](@tiptap\/|prosemirror-)/;

function coreSourceFiles(): string[] {
  return readdirSync(CORE_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(CORE_DIR, f));
}

describe("core purity", () => {
  it("has source files to check (guards against an empty-glob false pass)", () => {
    expect(coreSourceFiles().length).toBeGreaterThan(3);
  });

  it.each(coreSourceFiles())("%s imports no ProseMirror", (file) => {
    const source = readFileSync(file, "utf8");
    const offending = source.split("\n").filter((line) => FORBIDDEN.test(line));
    expect(offending).toEqual([]);
  });
});

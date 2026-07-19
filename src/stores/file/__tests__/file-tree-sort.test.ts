import type { FileEntry } from "../file";

import { describe, expect, it } from "vitest";

import {
  compareEntries,
  DEFAULT_SORT_ORDER,
  sortTreeNodes,
} from "../file-tree-sort";

const f = (name: string, isDir: boolean, modifiedAt = 0): FileEntry => ({
  isDir,
  name,
  path: `/r/${name}`,
  modifiedAt,
});

describe("file-tree-sort", () => {
  it("defaults to name ascending", () => {
    expect(DEFAULT_SORT_ORDER).toBe("name-asc");
  });

  it("keeps folders before files regardless of order", () => {
    const dir = f("z-dir", true);
    const file = f("a-file", false);
    for (const order of [
      "name-asc",
      "name-desc",
      "mtime-asc",
      "mtime-desc",
    ] as const) {
      expect(compareEntries(dir, file, order)).toBeLessThan(0);
      expect(compareEntries(file, dir, order)).toBeGreaterThan(0);
    }
  });

  it("sorts by name ascending and descending", () => {
    const a = f("apple.md", false);
    const b = f("banana.md", false);
    expect(compareEntries(a, b, "name-asc")).toBeLessThan(0);
    expect(compareEntries(a, b, "name-desc")).toBeGreaterThan(0);
  });

  it("sorts by modifiedAt ascending (oldest first) and descending (newest first)", () => {
    const older = f("old.md", false, 100);
    const newer = f("new.md", false, 200);
    expect(compareEntries(older, newer, "mtime-asc")).toBeLessThan(0);
    expect(compareEntries(older, newer, "mtime-desc")).toBeGreaterThan(0);
  });

  it("falls back to name when modifiedAt is equal or missing", () => {
    const a = f("a.md", false, 100);
    const b = f("b.md", false, 100);
    expect(compareEntries(a, b, "mtime-desc")).toBeLessThan(0); // a before b by name tiebreak
    const x: FileEntry = { isDir: false, name: "x.md", path: "/r/x.md" };
    const y: FileEntry = { isDir: false, name: "y.md", path: "/r/y.md" };
    expect(compareEntries(x, y, "mtime-asc")).toBeLessThan(0);
  });

  it("recursively resorts a nested tree without mutating the input", () => {
    const input: FileEntry[] = [
      f("b.md", false),
      {
        isDir: true,
        name: "dir",
        path: "/r/dir",
        children: [f("d.md", false), f("c.md", false)],
      },
      f("a.md", false),
    ];
    const out = sortTreeNodes(input, "name-asc");
    expect(out.map((n) => n.name)).toEqual(["dir", "a.md", "b.md"]);
    expect(out[0].children?.map((n) => n.name)).toEqual(["c.md", "d.md"]);
    // input untouched
    expect(input.map((n) => n.name)).toEqual(["b.md", "dir", "a.md"]);
  });
});

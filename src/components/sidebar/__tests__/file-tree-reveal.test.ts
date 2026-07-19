import { describe, expect, it } from "vitest";

import { ancestorDirs } from "../file-tree-reveal";

describe("ancestorDirs", () => {
  it("returns ancestor dirs between root and file, root-to-leaf", () => {
    expect(ancestorDirs("/vault/a/b/note.md", "/vault")).toEqual([
      "/vault/a",
      "/vault/a/b",
    ]);
  });

  it("returns empty when the file is a direct child of root", () => {
    expect(ancestorDirs("/vault/note.md", "/vault")).toEqual([]);
  });

  it("returns empty when the file is not under root", () => {
    expect(ancestorDirs("/other/x.md", "/vault")).toEqual([]);
  });

  it("does not include the root itself or the file itself", () => {
    const out = ancestorDirs("/vault/a/b/c/note.md", "/vault");
    expect(out).not.toContain("/vault");
    expect(out).not.toContain("/vault/a/b/c/note.md");
    expect(out).toEqual(["/vault/a", "/vault/a/b", "/vault/a/b/c"]);
  });
});

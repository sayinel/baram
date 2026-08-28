// #306 — "is this path inside that directory?", tested on BOTH separators.
//
// Four sites built the answer by appending `"/"` to the root. On Windows, where Rust hands the
// frontend backslash-delimited paths, that matched NOTHING — and failed silently, so each caller
// simply saw no files rather than an error. `getContextForPath` had the same defect and was fixed
// in §260 Phase 4a; these four were left out of that PR because they are plugin-independent.
//
// WHY THE SITES ARE TESTED TOGETHER: the bug is one property applied in four places, and two of
// them (`filterByJournalPrefix`, `isJournalPath`) had NO tests at all, which is how it survived.
// Every case below runs the POSIX and the Windows form of the same input, so a fix that only
// works on one platform fails here.
import { describe, expect, it } from "vitest";

import { flattenFileTree } from "../file-search";
import { isJournalPath } from "../journal/journal";
import {
  isUnderRoot,
  relativeToRoot,
  stripTrailingSeparators,
} from "../path-utils";
import { filterByJournalPrefix } from "../quick-switcher-query";

const file = (path: string, name: string) => ({
  name,
  path,
  relativePath: "",
});

describe("isUnderRoot tests the boundary, not a constructed prefix", () => {
  it("accepts a POSIX child", () => {
    expect(isUnderRoot("/vault/notes/a.md", "/vault")).toBe(true);
  });

  it("accepts a WINDOWS child — the case that matched nothing", () => {
    expect(isUnderRoot("C:\\vault\\notes\\a.md", "C:\\vault")).toBe(true);
  });

  it("accepts a POSIX root whose name contains a backslash", () => {
    // The rejected alternative fix inferred the separator from the path
    // (`includes("\\") ? "\\" : "/"`), which broke exactly this: a backslash is a legal
    // character in a POSIX directory name, so the root would never match its own files.
    expect(isUnderRoot("/home/me/my\\dir/a.md", "/home/me/my\\dir")).toBe(true);
  });

  it("tolerates trailing separators on the root, either kind", () => {
    expect(isUnderRoot("/vault/a.md", "/vault/")).toBe(true);
    expect(isUnderRoot("/vault/a.md", "/vault//")).toBe(true);
    expect(isUnderRoot("C:\\vault\\a.md", "C:\\vault\\")).toBe(true);
  });

  it("refuses a sibling that merely shares a prefix", () => {
    // The whole reason for a boundary check rather than `startsWith` alone.
    expect(isUnderRoot("/Users/me/workspace/note.md", "/Users/me/work")).toBe(
      false,
    );
    expect(isUnderRoot("C:\\me\\workspace\\n.md", "C:\\me\\work")).toBe(false);
  });

  it("refuses the root itself, and an empty root", () => {
    expect(isUnderRoot("/vault", "/vault")).toBe(false);
    expect(isUnderRoot("/vault/a.md", "")).toBe(false);
  });
});

describe("relativeToRoot normalises separators", () => {
  it("returns a POSIX-separated path from a Windows input", () => {
    // Not cosmetic: `extractNamespace` and every other consumer split on `/` alone, so a
    // relative path of `sub\a.md` yielded no namespace at all on Windows.
    expect(relativeToRoot("C:\\vault\\sub\\a.md", "C:\\vault")).toBe(
      "sub/a.md",
    );
  });

  it("leaves a POSIX input alone", () => {
    expect(relativeToRoot("/vault/sub/a.md", "/vault")).toBe("sub/a.md");
  });

  it("returns null rather than a wrongly sliced string when not contained", () => {
    expect(relativeToRoot("/other/a.md", "/vault")).toBeNull();
    expect(
      relativeToRoot("/Users/me/workspace/n.md", "/Users/me/work"),
    ).toBeNull();
  });
});

describe("stripTrailingSeparators", () => {
  it("drops either separator, however many", () => {
    expect(stripTrailingSeparators("/vault//")).toBe("/vault");
    expect(stripTrailingSeparators("C:\\vault\\\\")).toBe("C:\\vault");
    expect(stripTrailingSeparators("/vault")).toBe("/vault");
  });
});

describe("flattenFileTree keeps the directory part of every relative path", () => {
  /** Built per separator rather than string-substituted — a raw `\` is not valid inside JSON. */
  const treeFor = (root: string, sep: string) =>
    [
      {
        children: [
          {
            isDir: false,
            name: "a.md",
            path: `${root}${sep}sub${sep}a.md`,
          },
        ],
        isDir: true,
        name: "sub",
        path: `${root}${sep}sub`,
      },
    ] as never;

  it("POSIX", () => {
    const flat = flattenFileTree(treeFor("/vault", "/"), "/vault");
    expect(flat.map((f) => f.relativePath)).toEqual(["sub/a.md"]);
  });

  it("WINDOWS — previously fell back to the bare filename for every file", () => {
    const flat = flattenFileTree(treeFor("C:\\vault", "\\"), "C:\\vault");
    expect(flat.map((f) => f.relativePath)).toEqual(["sub/a.md"]);
  });
});

describe("filterByJournalPrefix (had no tests at all)", () => {
  const files = (sep: string) => [
    file(`J${sep}2026-07-30.md`, "2026-07-30.md"),
    file(`J${sep}daily${sep}d.md`, "d.md"),
    file(`J${sep}notes${sep}n.md`, "n.md"),
    file(`OTHER${sep}x.md`, "x.md"),
  ];

  it.each([
    ["POSIX", "/"],
    ["Windows", "\\"],
  ])("j: matches everything under the journal dir — %s", (_label, sep) => {
    const got = filterByJournalPrefix(files(sep), "j", "J");
    expect(got.map((f) => f.name)).toEqual(["2026-07-30.md", "d.md", "n.md"]);
  });

  it.each([
    ["POSIX", "/"],
    ["Windows", "\\"],
  ])("d: matches only the daily subdirectory — %s", (_label, sep) => {
    const got = filterByJournalPrefix(files(sep), "d", "J");
    expect(got.map((f) => f.name)).toEqual(["d.md"]);
  });

  it.each([
    ["POSIX", "/"],
    ["Windows", "\\"],
  ])("n: matches only the notes subdirectory — %s", (_label, sep) => {
    // The FOURTH site of this defect, in the same function; #306 listed three.
    const got = filterByJournalPrefix(files(sep), "n", "J");
    expect(got.map((f) => f.name)).toEqual(["n.md"]);
  });

  it("returns everything when there is no prefix or no journal dir", () => {
    expect(filterByJournalPrefix(files("/"), null, "J")).toHaveLength(4);
    expect(filterByJournalPrefix(files("/"), "j", "")).toHaveLength(4);
  });
});

describe("isJournalPath (had no tests at all)", () => {
  // `resolveJournalDir` accepts only an ABSOLUTE journal directory (`/…` or `C:\…`) and returns
  // null for anything relative, so these fixtures are absolute. Worth knowing: it ignores its
  // `rootPath` argument entirely.
  it.each([
    ["POSIX", "/vault/journal", "/vault/journal/2026-07-30.md"],
    ["Windows", "C:\\vault\\journal", "C:\\vault\\journal\\2026-07-30.md"],
  ])("recognises a note inside the journal directory — %s", (_l, dir, file) => {
    expect(isJournalPath(file, null, dir)).toBe(true);
  });

  it.each([
    ["POSIX", "/vault/journal", "/vault/journal-archive/a.md"],
    ["Windows", "C:\\vault\\journal", "C:\\vault\\journal-archive\\a.md"],
  ])("refuses a sibling that shares the prefix — %s", (_l, dir, file) => {
    expect(isJournalPath(file, null, dir)).toBe(false);
  });

  it("tolerates a trailing separator on the user-editable directory setting", () => {
    expect(isJournalPath("/vault/journal/a.md", null, "/vault/journal/")).toBe(
      true,
    );
  });

  it("refuses an empty or absent path", () => {
    expect(isJournalPath(null, null, "/vault/journal")).toBe(false);
    expect(isJournalPath(undefined, null, "/vault/journal")).toBe(false);
  });
});

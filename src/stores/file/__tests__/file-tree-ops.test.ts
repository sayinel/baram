import type { FileEntry as IpcFileEntry } from "../../../ipc/types";
import type { FileEntry } from "../file";

import { describe, expect, it } from "vitest";

import {
  addToTree,
  buildFileTree,
  insertSorted,
  moveInTree,
  rekeyOpenFilesPrefix,
  removeFromTree,
  renameInTree,
} from "../file-tree-ops";

const f = (
  name: string,
  path: string,
  isDir = false,
  modifiedAt = 0,
): FileEntry => ({
  isDir,
  name,
  path,
  modifiedAt,
});

describe("buildFileTree", () => {
  it("groups flat IPC entries into a nested tree, dirs sorted first", () => {
    const flat: IpcFileEntry[] = [
      { name: "b.md", path: "/r/b.md", isDir: false, modifiedAt: 0, size: 0 },
      { name: "dir", path: "/r/dir", isDir: true, modifiedAt: 0, size: 0 },
      {
        name: "c.md",
        path: "/r/dir/c.md",
        isDir: false,
        modifiedAt: 0,
        size: 0,
      },
      { name: "a.md", path: "/r/a.md", isDir: false, modifiedAt: 0, size: 0 },
    ];
    const tree = buildFileTree(flat, "/r", "name-asc");
    expect(tree.map((n) => n.name)).toEqual(["dir", "a.md", "b.md"]);
    expect(tree[0].children?.map((n) => n.name)).toEqual(["c.md"]);
  });
});

describe("insertSorted", () => {
  it("inserts in sorted position", () => {
    const entries = [f("a.md", "/r/a.md"), f("c.md", "/r/c.md")];
    const result = insertSorted(entries, f("b.md", "/r/b.md"), "name-asc");
    expect(result.map((e) => e.name)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("is idempotent — a duplicate path is a no-op, not a second entry", () => {
    const entries = [f("a.md", "/r/a.md"), f("b.md", "/r/b.md")];
    const duplicate = f("a.md", "/r/a.md", false, 999); // same path, different metadata
    const result = insertSorted(entries, duplicate, "name-asc");
    expect(result).toHaveLength(2);
    // the pre-existing entry is kept as-is (not overwritten by the duplicate)
    expect(result.find((e) => e.path === "/r/a.md")?.modifiedAt).toBe(0);
  });
});

describe("addToTree", () => {
  it("inserts at the top level when parentPath === rootPath", () => {
    const tree = [f("a.md", "/r/a.md")];
    const result = addToTree(
      tree,
      "/r",
      "/r",
      f("b.md", "/r/b.md"),
      "name-asc",
    );
    expect(result.map((e) => e.name)).toEqual(["a.md", "b.md"]);
  });

  it("inserts under a nested directory", () => {
    const tree = [f("dir", "/r/dir", true, 0)];
    tree[0].children = [];
    const result = addToTree(
      tree,
      "/r/dir",
      "/r",
      f("new.md", "/r/dir/new.md"),
      "name-asc",
    );
    expect(result[0].children?.map((e) => e.name)).toEqual(["new.md"]);
  });
});

describe("removeFromTree", () => {
  it("removes a top-level entry", () => {
    const tree = [f("a.md", "/r/a.md"), f("b.md", "/r/b.md")];
    expect(removeFromTree(tree, "/r/a.md").map((e) => e.name)).toEqual([
      "b.md",
    ]);
  });

  it("removes a directory and its subtree", () => {
    const tree = [
      {
        ...f("dir", "/r/dir", true),
        children: [f("child.md", "/r/dir/child.md")],
      },
      f("keep.md", "/r/keep.md"),
    ];
    const result = removeFromTree(tree, "/r/dir");
    expect(result.map((e) => e.name)).toEqual(["keep.md"]);
  });
});

describe("renameInTree", () => {
  it("renames a file entry", () => {
    const tree = [f("old.md", "/r/old.md")];
    const result = renameInTree(tree, "/r/old.md", "/r/new.md", "new.md");
    expect(result[0]).toMatchObject({ name: "new.md", path: "/r/new.md" });
  });

  it("rekeys descendant paths when renaming a directory", () => {
    const tree = [
      {
        ...f("dir", "/r/dir", true),
        children: [
          f("a.md", "/r/dir/a.md"),
          {
            ...f("sub", "/r/dir/sub", true),
            children: [f("b.md", "/r/dir/sub/b.md")],
          },
        ],
      },
    ];
    const result = renameInTree(tree, "/r/dir", "/r/dir2", "dir2");
    expect(result[0].path).toBe("/r/dir2");
    expect(result[0].children?.[0].path).toBe("/r/dir2/a.md");
    expect(result[0].children?.[1].path).toBe("/r/dir2/sub");
    expect(result[0].children?.[1].children?.[0].path).toBe("/r/dir2/sub/b.md");
  });
});

describe("moveInTree", () => {
  it("returns null when the source entry isn't found", () => {
    expect(
      moveInTree([], "/r/missing.md", "/r/dest", "/r", "name-asc"),
    ).toBeNull();
  });

  it("moves a file to a new parent directory", () => {
    const tree = [
      f("a.md", "/r/a.md"),
      { ...f("dest", "/r/dest", true), children: [] },
    ];
    const result = moveInTree(tree, "/r/a.md", "/r/dest", "/r", "name-asc");
    expect(result?.newPath).toBe("/r/dest/a.md");
    const dest = result?.entries.find((e) => e.path === "/r/dest");
    expect(dest?.children?.map((c) => c.path)).toEqual(["/r/dest/a.md"]);
    expect(result?.entries.some((e) => e.path === "/r/a.md")).toBe(false);
  });

  it("rekeys descendant paths when moving a directory", () => {
    const tree = [
      {
        ...f("docs", "/r/docs", true),
        children: [f("a.md", "/r/docs/a.md")],
      },
      { ...f("dest", "/r/dest", true), children: [] },
    ];
    const result = moveInTree(tree, "/r/docs", "/r/dest", "/r", "name-asc");
    const dest = result?.entries.find((e) => e.path === "/r/dest");
    const movedDocs = dest?.children?.find((e) => e.path === "/r/dest/docs");
    expect(movedDocs?.children?.map((c) => c.path)).toEqual([
      "/r/dest/docs/a.md",
    ]);
  });

  it("moves to the top level when newParentPath === rootPath", () => {
    const tree = [
      { ...f("dir", "/r/dir", true), children: [f("a.md", "/r/dir/a.md")] },
    ];
    const result = moveInTree(tree, "/r/dir/a.md", "/r", "/r", "name-asc");
    expect(result?.newPath).toBe("/r/a.md");
    expect(result?.entries.map((e) => e.path)).toContain("/r/a.md");
  });

  // §4-2 drift fix: moveFileEntry's insertSorted previously had no idempotency
  // check (unlike addFileEntry's), so a move onto a path that already existed
  // at the destination appended a second tree node with the same path
  // instead of resolving the collision. This is reachable for a
  // file-onto-file collision: `rename` on the Rust side succeeds there by
  // overwriting the destination file on disk (a directory-onto-directory
  // collision can't reach this path — `rename` fails on a non-empty
  // destination directory). Unifying on the idempotent insertSorted means
  // the pre-existing destination entry wins and the moved entry is dropped
  // from the tree — pinned here so the tradeoff is explicit.
  it("is idempotent when the destination already holds an entry at the moved-to path", () => {
    const preExisting = f("a.md", "/r/dest/a.md", false, 42);
    const tree = [
      f("a.md", "/r/a.md", false, 1),
      { ...f("dest", "/r/dest", true), children: [preExisting] },
    ];
    const result = moveInTree(tree, "/r/a.md", "/r/dest", "/r", "name-asc");
    const dest = result?.entries.find((e) => e.path === "/r/dest");
    // exactly one node at the destination path — no duplicate
    expect(
      dest?.children?.filter((c) => c.path === "/r/dest/a.md"),
    ).toHaveLength(1);
    // the pre-existing destination entry is kept, not the moved one
    expect(dest?.children?.[0].modifiedAt).toBe(42);
    // the source is still removed regardless
    expect(result?.entries.some((e) => e.path === "/r/a.md")).toBe(false);
  });
});

describe("rekeyOpenFilesPrefix", () => {
  it("rewrites a single file key", () => {
    const openFiles = new Map([["/r/a.md", "content"]]);
    const result = rekeyOpenFilesPrefix(openFiles, "/r/a.md", "/r/b.md");
    expect(result.get("/r/b.md")).toBe("content");
    expect(result.has("/r/a.md")).toBe(false);
  });

  it("rewrites every key under a directory prefix, leaving unrelated keys alone", () => {
    const openFiles = new Map([
      ["/r/docs/a.md", "content-a"],
      ["/r/docs/sub/b.md", "content-b"],
      ["/r/unrelated.md", "keep"],
    ]);
    const result = rekeyOpenFilesPrefix(openFiles, "/r/docs", "/r/dest/docs");
    expect(result.get("/r/dest/docs/a.md")).toBe("content-a");
    expect(result.get("/r/dest/docs/sub/b.md")).toBe("content-b");
    expect(result.get("/r/unrelated.md")).toBe("keep");
    expect(result.has("/r/docs/a.md")).toBe(false);
  });
});

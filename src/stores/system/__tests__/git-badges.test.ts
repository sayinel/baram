import type { GitChange } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { buildGitBadgeIndex, EMPTY_GIT_BADGE_INDEX } from "../git-badges";

const ch = (path: string, status: string): GitChange => ({
  path,
  status,
  staged: false,
});

const ROOT = "/repo";

describe("buildGitBadgeIndex", () => {
  it("returns an empty index when repoRoot is null", () => {
    const idx = buildGitBadgeIndex([ch("a.md", "modified")], null, ROOT);
    expect(idx.files.size).toBe(0);
    expect(idx.dirs.size).toBe(0);
  });

  it("maps modified/renamed to 'modified' and added/untracked to 'added'", () => {
    const idx = buildGitBadgeIndex(
      [
        ch("m.md", "modified"),
        ch("r.md", "renamed"),
        ch("a.md", "added"),
        ch("u.md", "untracked"),
      ],
      ROOT,
      ROOT,
    );
    expect(idx.files.get("/repo/m.md")).toBe("modified");
    expect(idx.files.get("/repo/r.md")).toBe("modified");
    expect(idx.files.get("/repo/a.md")).toBe("added");
    expect(idx.files.get("/repo/u.md")).toBe("added");
  });

  it("does not create a file badge for deleted, but rolls it up to folders", () => {
    const idx = buildGitBadgeIndex([ch("sub/gone.md", "deleted")], ROOT, ROOT);
    expect(idx.files.has("/repo/sub/gone.md")).toBe(false);
    expect(idx.dirs.has("/repo/sub")).toBe(true);
  });

  it("rolls changes up to every ancestor folder under rootPath", () => {
    const idx = buildGitBadgeIndex([ch("a/b/c.md", "modified")], ROOT, ROOT);
    expect(idx.files.get("/repo/a/b/c.md")).toBe("modified");
    expect(idx.dirs.has("/repo/a")).toBe(true);
    expect(idx.dirs.has("/repo/a/b")).toBe(true);
    expect(idx.dirs.has("/repo")).toBe(false); // rootPath itself is not a badge target
  });

  it("resolves repo-relative paths against repoRoot when the vault is a subdir", () => {
    // repo at /repo, vault (rootPath) at /repo/vault; change path is repo-relative
    const idx = buildGitBadgeIndex(
      [ch("vault/note.md", "modified"), ch("other/x.md", "modified")],
      "/repo",
      "/repo/vault",
    );
    expect(idx.files.get("/repo/vault/note.md")).toBe("modified");
    // a change outside the vault is ignored (not in the tree)
    expect(idx.files.has("/repo/other/x.md")).toBe(false);
    expect(idx.dirs.has("/repo/vault")).toBe(false); // rootPath itself excluded
  });

  it("modified wins over added on a per-path collision (staged + workdir rows)", () => {
    const idx = buildGitBadgeIndex(
      [ch("f.md", "added"), ch("f.md", "modified")],
      ROOT,
      ROOT,
    );
    expect(idx.files.get("/repo/f.md")).toBe("modified");
  });

  it("normalizes a trailing slash on repoRoot (libgit2 workdir)", () => {
    const idx = buildGitBadgeIndex([ch("a.md", "modified")], "/repo/", ROOT);
    expect(idx.files.get("/repo/a.md")).toBe("modified");
  });

  it("EMPTY_GIT_BADGE_INDEX is empty", () => {
    expect(EMPTY_GIT_BADGE_INDEX.files.size).toBe(0);
    expect(EMPTY_GIT_BADGE_INDEX.dirs.size).toBe(0);
  });

  it("normalizes backslash paths (Windows) to match forward-slash change paths", () => {
    // rootPath/repoRoot come from Tauri with backslashes on Windows;
    // git change paths use forward slashes.
    const idx = buildGitBadgeIndex(
      [{ path: "a/b.md", status: "modified", staged: false }],
      "C:\\repo",
      "C:\\repo",
    );
    expect(idx.files.get("C:/repo/a/b.md")).toBe("modified");
    expect(idx.dirs.has("C:/repo/a")).toBe(true);
  });
});

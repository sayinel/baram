import type { GitChange } from "../../ipc/types";

// §57b Git Store — utility function tests
import { describe, expect, it } from "vitest";

import { groupChanges, statusColorClass, statusIcon } from "../system/git";

describe("groupChanges", () => {
  it("separates staged and unstaged changes", () => {
    const changes: GitChange[] = [
      { path: "a.md", status: "modified", staged: true },
      { path: "b.md", status: "added", staged: false },
      { path: "c.md", status: "deleted", staged: true },
      { path: "d.md", status: "untracked", staged: false },
    ];

    const { staged, unstaged } = groupChanges(changes);
    expect(staged).toHaveLength(2);
    expect(unstaged).toHaveLength(2);
    expect(staged.map((c) => c.path)).toEqual(["a.md", "c.md"]);
    expect(unstaged.map((c) => c.path)).toEqual(["b.md", "d.md"]);
  });

  it("handles empty changes", () => {
    const { staged, unstaged } = groupChanges([]);
    expect(staged).toHaveLength(0);
    expect(unstaged).toHaveLength(0);
  });

  it("handles all staged", () => {
    const changes: GitChange[] = [
      { path: "x.md", status: "modified", staged: true },
    ];
    const { staged, unstaged } = groupChanges(changes);
    expect(staged).toHaveLength(1);
    expect(unstaged).toHaveLength(0);
  });

  it("handles all unstaged", () => {
    const changes: GitChange[] = [
      { path: "y.md", status: "untracked", staged: false },
    ];
    const { staged, unstaged } = groupChanges(changes);
    expect(staged).toHaveLength(0);
    expect(unstaged).toHaveLength(1);
  });
});

describe("statusIcon", () => {
  it("returns M for modified", () => {
    expect(statusIcon("modified")).toBe("M");
  });

  it("returns A for added", () => {
    expect(statusIcon("added")).toBe("A");
  });

  it("returns D for deleted", () => {
    expect(statusIcon("deleted")).toBe("D");
  });

  it("returns R for renamed", () => {
    expect(statusIcon("renamed")).toBe("R");
  });

  it("returns U for untracked", () => {
    expect(statusIcon("untracked")).toBe("U");
  });

  it("returns ? for unknown", () => {
    expect(statusIcon("whatever")).toBe("?");
  });
});

describe("statusColorClass", () => {
  it("returns correct class for modified", () => {
    expect(statusColorClass("modified")).toBe("git-status-modified");
  });

  it("returns correct class for added", () => {
    expect(statusColorClass("added")).toBe("git-status-added");
  });

  it("returns correct class for untracked (same as added)", () => {
    expect(statusColorClass("untracked")).toBe("git-status-added");
  });

  it("returns correct class for deleted", () => {
    expect(statusColorClass("deleted")).toBe("git-status-deleted");
  });

  it("returns correct class for renamed", () => {
    expect(statusColorClass("renamed")).toBe("git-status-renamed");
  });

  it("returns empty string for unknown", () => {
    expect(statusColorClass("xyz")).toBe("");
  });
});

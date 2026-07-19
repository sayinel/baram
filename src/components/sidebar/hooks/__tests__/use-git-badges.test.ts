import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { useGitStore } from "../../../../stores/system/git";
import { useGitBadges } from "../use-git-badges";

beforeEach(() => {
  useGitStore.setState({
    isRepo: true,
    repoRoot: "/repo",
    changes: [{ path: "a.md", status: "modified", staged: false }],
  });
});

describe("useGitBadges", () => {
  it("derives a badge index from git store changes", () => {
    const { result } = renderHook(() => useGitBadges("/repo"));
    expect(result.current.files.get("/repo/a.md")).toBe("modified");
  });

  it("returns an empty index when not a git repo", () => {
    useGitStore.setState({ isRepo: false, repoRoot: null, changes: [] });
    const { result } = renderHook(() => useGitBadges("/repo"));
    expect(result.current.files.size).toBe(0);
    expect(result.current.dirs.size).toBe(0);
  });
});

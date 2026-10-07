// §390 spec 0069 §5 — the file tree's search scores each match once, then
// sorts, as Quick Switcher does (QuickSwitcher.score-count.test.tsx has why).
import type { FileEntry } from "../../../../stores/file/file";

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { fuzzyScore } = vi.hoisted(() => ({ fuzzyScore: vi.fn() }));

vi.mock("../../../../utils/file-search", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../utils/file-search")>();
  fuzzyScore.mockImplementation(actual.fuzzyScore);
  return { ...actual, fuzzyScore };
});

import { useFileStore } from "../../../../stores/file/file";
import { useFileTreeSearch } from "../use-file-tree-search";

const COUNT = 200;

describe("§390 the file tree's search", () => {
  it("scores each match once", () => {
    // What fails this: `searchResults` sorting with a comparator that calls
    // fuzzyScore — two calls per comparison. The names' scores cycle (the gap
    // before `note` grows), so no stretch is already sorted.
    useFileStore.setState({
      fileTree: Array.from({ length: COUNT }, (_, i) => {
        const name = `${"x".repeat(i % 7)}note-${i}.md`;
        return { isDir: false, name, path: `/v/${name}` } as FileEntry;
      }),
      rootPath: "/v",
      tagFilter: null,
    });
    const { result } = renderHook(() => useFileTreeSearch());
    fuzzyScore.mockClear();
    act(() => result.current.setSearchQuery("note"));
    expect(result.current.searchResults).toHaveLength(COUNT);
    expect(fuzzyScore.mock.calls.length).toBeGreaterThanOrEqual(COUNT);
    expect(fuzzyScore.mock.calls.length).toBeLessThanOrEqual(2 * COUNT);
  });
});

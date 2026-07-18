import type { FileEntry } from "../../../stores/file/file";

import { describe, expect, it } from "vitest";

import { computeVisibleEntries } from "../file-tree-visible";

// FileTree.tsx의 태그 필터와 동일한 시그니처의 최소 구현
function matchesTagFilter(entry: FileEntry, paths: Set<string>): boolean {
  if (!entry.isDir) return paths.has(entry.path);
  return (entry.children ?? []).some((c) => matchesTagFilter(c, paths));
}

const tree: FileEntry[] = [
  {
    name: "docs",
    path: "/r/docs",
    isDir: true,
    children: [
      { name: "a.md", path: "/r/docs/a.md", isDir: false },
      {
        name: "sub",
        path: "/r/docs/sub",
        isDir: true,
        children: [{ name: "b.md", path: "/r/docs/sub/b.md", isDir: false }],
      },
    ],
  },
  { name: "z.md", path: "/r/z.md", isDir: false },
];

describe("computeVisibleEntries", () => {
  it("접힌 트리는 최상위 항목만 순서대로 반환한다", () => {
    const out = computeVisibleEntries(tree, new Set(), null, matchesTagFilter);
    expect(out.map((e) => e.path)).toEqual(["/r/docs", "/r/z.md"]);
  });

  it("펼친 폴더의 자식은 부모 바로 뒤에 깊이 우선으로 삽입된다", () => {
    const out = computeVisibleEntries(
      tree,
      new Set(["/r/docs"]),
      null,
      matchesTagFilter,
    );
    expect(out.map((e) => e.path)).toEqual([
      "/r/docs",
      "/r/docs/a.md",
      "/r/docs/sub",
      "/r/z.md",
    ]);
  });

  it("중첩 폴더 펼침도 렌더 순서와 일치한다", () => {
    const out = computeVisibleEntries(
      tree,
      new Set(["/r/docs", "/r/docs/sub"]),
      null,
      matchesTagFilter,
    );
    expect(out.map((e) => e.path)).toEqual([
      "/r/docs",
      "/r/docs/a.md",
      "/r/docs/sub",
      "/r/docs/sub/b.md",
      "/r/z.md",
    ]);
  });

  it("태그 필터는 최상위에만 적용되고 펼친 폴더의 자식은 필터링하지 않는다", () => {
    // FileTree.tsx:407-411 렌더 로직과 동일해야 한다 (top-level만 filter)
    const filtered = new Set(["/r/docs/a.md"]);
    const out = computeVisibleEntries(
      tree,
      new Set(["/r/docs"]),
      filtered,
      matchesTagFilter,
    );
    // /r/z.md는 최상위에서 탈락, /r/docs/sub는 자식이라 남는다
    expect(out.map((e) => e.path)).toEqual([
      "/r/docs",
      "/r/docs/a.md",
      "/r/docs/sub",
    ]);
  });
});

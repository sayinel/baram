import { describe, expect, it } from "vitest";

import {
  firstChildPath,
  isDirPath,
  type NavEntry,
  nextPath,
  parentPath,
  prevPath,
} from "../file-tree-keyboard-nav";

// visible 순서 (렌더 순서): docs(dir) > docs/a.md > docs/sub(dir) > docs/sub/b.md > z.md
const entries: NavEntry[] = [
  { path: "/r/docs", isDir: true },
  { path: "/r/docs/a.md", isDir: false },
  { path: "/r/docs/sub", isDir: true },
  { path: "/r/docs/sub/b.md", isDir: false },
  { path: "/r/z.md", isDir: false },
];
const paths = entries.map((e) => e.path);

describe("nextPath / prevPath", () => {
  it("current 다음/이전 항목을 반환한다", () => {
    expect(nextPath(paths, "/r/docs")).toBe("/r/docs/a.md");
    expect(prevPath(paths, "/r/docs/a.md")).toBe("/r/docs");
  });
  it("끝/처음에서는 경계를 유지한다", () => {
    expect(nextPath(paths, "/r/z.md")).toBe("/r/z.md");
    expect(prevPath(paths, "/r/docs")).toBe("/r/docs");
  });
  it("current가 null이면 첫 항목을 반환한다", () => {
    expect(nextPath(paths, null)).toBe("/r/docs");
    expect(prevPath(paths, null)).toBe("/r/docs");
  });
  it("current가 목록에 없으면 첫 항목을 반환한다", () => {
    expect(nextPath(paths, "/gone")).toBe("/r/docs");
  });
  it("prevPath: current가 목록에 없으면 첫 항목을 반환한다", () => {
    expect(prevPath(paths, "/gone")).toBe("/r/docs");
  });
});

describe("firstChildPath", () => {
  it("펼친 폴더의 첫 자식(바로 뒤 + 더 깊은 경로)을 반환한다", () => {
    expect(firstChildPath(entries, "/r/docs")).toBe("/r/docs/a.md");
    expect(firstChildPath(entries, "/r/docs/sub")).toBe("/r/docs/sub/b.md");
  });
  it("바로 뒤 항목이 자식이 아니면 null (접힌 폴더)", () => {
    const collapsed: NavEntry[] = [
      { path: "/r/docs", isDir: true },
      { path: "/r/z.md", isDir: false },
    ];
    expect(firstChildPath(collapsed, "/r/docs")).toBeNull();
  });
});

describe("parentPath", () => {
  it("자식의 부모 디렉토리가 visible에 있으면 반환한다", () => {
    expect(parentPath(entries, "/r/docs/a.md", "/r")).toBe("/r/docs");
    expect(parentPath(entries, "/r/docs/sub/b.md", "/r")).toBe("/r/docs/sub");
  });
  it("루트 직속 항목은 null", () => {
    expect(parentPath(entries, "/r/z.md", "/r")).toBeNull();
    expect(parentPath(entries, "/r/docs", "/r")).toBeNull();
  });
});

describe("isDirPath", () => {
  it("경로의 isDir 여부를 반환한다", () => {
    expect(isDirPath(entries, "/r/docs")).toBe(true);
    expect(isDirPath(entries, "/r/z.md")).toBe(false);
    expect(isDirPath(entries, "/gone")).toBe(false);
  });
});

describe("empty inputs", () => {
  it("빈 배열은 안전하게 null/false를 반환한다", () => {
    expect(nextPath([], null)).toBeNull();
    expect(prevPath([], null)).toBeNull();
    expect(firstChildPath([], "/r/docs")).toBeNull();
    expect(parentPath([], "/r/docs/a.md", "/r")).toBeNull();
    expect(isDirPath([], "/r/docs")).toBe(false);
  });
});

describe("sibling-prefix safety", () => {
  const sib: NavEntry[] = [
    { path: "/r/doc", isDir: true },
    { path: "/r/docs", isDir: true },
    { path: "/r/docs/a.md", isDir: false },
  ];
  it("firstChildPath는 형제 접두어를 자식으로 오인하지 않는다", () => {
    // /r/doc의 바로 뒤는 /r/docs (형제, 자식 아님) → null
    expect(firstChildPath(sib, "/r/doc")).toBeNull();
    expect(firstChildPath(sib, "/r/docs")).toBe("/r/docs/a.md");
  });
  it("parentPath는 형제 접두어를 부모로 오인하지 않는다", () => {
    expect(parentPath(sib, "/r/docs/a.md", "/r")).toBe("/r/docs");
  });
});

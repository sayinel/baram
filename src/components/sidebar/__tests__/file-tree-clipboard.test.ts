import { describe, expect, it } from "vitest";

import { toRelativePath, toWikilinkLabel } from "../file-tree-clipboard";

describe("toRelativePath", () => {
  it("vault 루트 기준 상대 경로를 선행 슬래시 없이 반환한다", () => {
    expect(toRelativePath("/r/docs/a.md", "/r")).toBe("docs/a.md");
  });
  it("루트 바로 아래 파일은 파일명만 반환한다", () => {
    expect(toRelativePath("/r/a.md", "/r")).toBe("a.md");
  });
  it("루트 밖 경로는 절대 경로를 그대로 반환한다", () => {
    expect(toRelativePath("/other/a.md", "/r")).toBe("/other/a.md");
  });
});

describe("toWikilinkLabel", () => {
  const paths = ["/r/a.md", "/r/docs/a.md", "/r/unique.md"];
  it("파일명이 유일하면 확장자 제거한 파일명을 반환한다", () => {
    expect(toWikilinkLabel("/r/unique.md", "/r", paths)).toBe("unique");
  });
  it("동명(확장자 제거) 파일이 2개 이상이면 확장자 제거한 상대 경로를 반환한다", () => {
    expect(toWikilinkLabel("/r/docs/a.md", "/r", paths)).toBe("docs/a");
    expect(toWikilinkLabel("/r/a.md", "/r", paths)).toBe("a");
  });
  it("확장자 없는 파일은 파일명을 그대로 쓴다", () => {
    expect(toWikilinkLabel("/r/README", "/r", ["/r/README"])).toBe("README");
  });
});

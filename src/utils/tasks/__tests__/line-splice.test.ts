import { describe, expect, it } from "vitest";

import { isSameLine, lineAt, spliceLine } from "../line-splice";

describe("lineAt", () => {
  it("드러내는 줄에서 종결자를 뗀다", () => {
    expect(lineAt("a\nb\nc\n", 1)).toBe("b");
  });

  it("CRLF의 \\r까지 뗀다 — Rust의 str::lines()와 같은 규칙", () => {
    expect(lineAt("a\r\nb\r\n", 0)).toBe("a");
  });

  it("마지막 줄에 개행이 없어도 읽는다", () => {
    expect(lineAt("a\nb", 1)).toBe("b");
  });

  it("범위를 벗어나면 null", () => {
    expect(lineAt("a\n", 5)).toBeNull();
  });
});

describe("spliceLine", () => {
  it("LF 파일의 한 줄만 바꾼다", () => {
    expect(spliceLine("a\nb\nc\n", 1, "B")).toBe("a\nB\nc\n");
  });

  it("CRLF 파일의 줄바꿈을 보존한다", () => {
    expect(spliceLine("a\r\nb\r\nc\r\n", 1, "B")).toBe("a\r\nB\r\nc\r\n");
  });

  it("혼합 EOL에서 건드리지 않은 줄의 종결자를 그대로 둔다", () => {
    // M1에서 실제 데이터 손실을 낸 형태(fd8dbe7d). 첫 줄만 CRLF다.
    expect(spliceLine("a\r\nb\nc\n", 0, "A")).toBe("A\r\nb\nc\n");
  });

  it("마지막 줄에 개행이 없으면 없는 채로 둔다", () => {
    expect(spliceLine("a\nb", 1, "B")).toBe("a\nB");
  });

  it("마지막 줄에 개행이 있으면 있는 채로 둔다", () => {
    expect(spliceLine("a\nb\n", 1, "B")).toBe("a\nB\n");
  });

  it("범위를 벗어나면 null — 호출자가 stale로 처리한다", () => {
    expect(spliceLine("a\n", 5, "X")).toBeNull();
  });

  it("한글이 섞인 줄에서 바이트가 아니라 문자로 자른다", () => {
    expect(
      spliceLine("- [ ] 보고서 초안\n다음\n", 0, "- [x] 보고서 초안"),
    ).toBe("- [x] 보고서 초안\n다음\n");
  });
});

describe("isSameLine", () => {
  it("뒤쪽 공백을 무시한다 — Rust replace_line의 trim_end() 대응", () => {
    expect(isSameLine("- [ ] a  ", "- [ ] a")).toBe(true);
  });

  it("앞쪽 들여쓰기는 무시하지 않는다", () => {
    expect(isSameLine("  - [ ] a", "- [ ] a")).toBe(false);
  });

  it("본문이 다르면 false", () => {
    expect(isSameLine("- [ ] a", "- [ ] b")).toBe(false);
  });
});

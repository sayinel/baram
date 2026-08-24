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

describe("경계 케이스", () => {
  it("빈 문자열은 범위 밖으로 취급한다", () => {
    expect(lineAt("", 0)).toBeNull();
    expect(spliceLine("", 0, "X")).toBeNull();
  });

  it("개행 하나뿐인 내용의 유일한 줄을 다룬다", () => {
    expect(lineAt("\n", 0)).toBe("");
    expect(spliceLine("\n", 0, "X")).toBe("X\n");
  });

  it("줄 개수와 같은 인덱스, 음수 인덱스 모두 범위 밖이다", () => {
    expect(lineAt("a\n", 1)).toBeNull();
    expect(spliceLine("a\n", 1, "X")).toBeNull();
    expect(lineAt("a\n", -1)).toBeNull();
    expect(spliceLine("a\n", -1, "X")).toBeNull();
  });

  it("LF를 동반하지 않은 \\r은 줄 본문 안에서 그대로 남는다", () => {
    expect(lineAt("a\r\r\n", 0)).toBe("a\r");
  });

  it("한글과 이모지가 섞인 줄을 문자 단위로 안전하게 바꾼다", () => {
    expect(lineAt("회의 📅 내일\n다음\n", 0)).toBe("회의 📅 내일");
    expect(spliceLine("회의 📅 내일\n다음\n", 0, "완료 📅 오늘")).toBe(
      "완료 📅 오늘\n다음\n",
    );
  });

  it("빈 줄을 갈아끼워도 삼켜지지 않는다", () => {
    expect(spliceLine("a\n\n", 1, "X")).toBe("a\nX\n");
  });

  it("여러 줄짜리 newText를 거절한다 — 줄 번호가 어긋나면 조용한 문서 손상이 된다", () => {
    expect(() => spliceLine("a\nb\n", 0, "X\nY")).toThrow(/single line/);
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

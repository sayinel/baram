// §312 최소 교체 구간.
//
// 단정의 성격이 둘이다: (1) 결과가 실제로 `next`가 된다(정확성), (2) 구간이 **바뀐 곳만
// 덮는다**(최소성). 두 번째가 없으면 캐럿·스크롤 보존이 무너진다 — 전체 교체도 (1)은
// 통과하기 때문에 최소성을 따로 세지 않으면 회귀를 못 잡는다.
import { describe, expect, it } from "vitest";

import { textReplaceRange } from "../text-replace-range";

/** 구간을 적용한 결과 — 정확성 단정의 공통 부분. */
function apply(current: string, next: string): string {
  const change = textReplaceRange(current, next);
  if (!change) return current;
  return (
    current.slice(0, change.from) + change.insert + current.slice(change.to)
  );
}

describe("textReplaceRange", () => {
  it("같은 문자열이면 아무것도 하지 않는다", () => {
    expect(textReplaceRange("- [ ] a\n", "- [ ] a\n")).toBeNull();
  });

  it("길이가 같은 한 글자 변경은 그 한 글자만 덮는다", () => {
    const before = "- [ ] alpha\n- [ ] beta\n";
    const after = "- [x] alpha\n- [ ] beta\n";
    const change = textReplaceRange(before, after);
    expect(change).toEqual({ from: 3, insert: "x", to: 4 });
    expect(apply(before, after)).toBe(after);
  });

  it("삽입은 빈 구간에 넣는다", () => {
    const before = "- [ ] alpha\n";
    const after = "- [ ] alpha 📅 2026-08-26\n";
    const change = textReplaceRange(before, after);
    expect(change?.from).toBe(change?.to);
    expect(apply(before, after)).toBe(after);
  });

  it("삭제는 빈 문자열을 넣는다", () => {
    const before = "- [ ] alpha\n- [ ] beta\n";
    const after = "- [ ] beta\n";
    const change = textReplaceRange(before, after);
    expect(change?.insert).toBe("");
    expect(apply(before, after)).toBe(after);
  });

  it("문서 전체가 달라지면 전체를 덮는다", () => {
    const before = "aaa";
    const after = "bbb";
    expect(textReplaceRange(before, after)).toEqual({
      from: 0,
      insert: "bbb",
      to: 3,
    });
  });

  it("서로게이트 쌍 한가운데를 자르지 않는다", () => {
    // 두 이모지는 상위 서로게이트(0xD83D)를 공유한다 — 코드 유닛만 세면 그 사이에서
    // 멈춰 홀로 남은 하위 서로게이트를 만든다.
    const before = "due 📅 x";
    const after = "due 📆 x";
    const change = textReplaceRange(before, after);
    expect(change).not.toBeNull();
    expect(isHighSurrogateAt(before, change!.from - 1)).toBe(false);
    expect(apply(before, after)).toBe(after);
  });

  it("빈 문자열 양방향", () => {
    expect(apply("", "hello")).toBe("hello");
    expect(apply("hello", "")).toBe("");
  });

  it("반복 문자열에서도 결과가 정확하다", () => {
    // 접두와 접미가 겹칠 수 있는 모양 — 구간이 뒤집히면 결과가 깨진다.
    expect(apply("aaaa", "aa")).toBe("aa");
    expect(apply("aa", "aaaa")).toBe("aaaa");
  });
});

function isHighSurrogateAt(s: string, index: number): boolean {
  if (index < 0) return false;
  const code = s.charCodeAt(index);
  return code >= 0xd800 && code <= 0xdbff;
}

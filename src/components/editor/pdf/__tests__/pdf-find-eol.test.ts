// §272.6 이 파일은 통째로 다시 쓰였다.
//
// 이전 버전은 "findController 오프셋은 합성 \n이 들어간 도메인에 있다"는
// **틀린 전제**를 고정하고 있었다 — 심지어 "MUTATION PROOF"라는 이름의
// 테스트가 *올바른* 동작(보정 없는 변환)을 "틀린 것"으로 단정했다. 그래서
// 두 번째 이후 매치가 앞선 EOL 개수만큼 왼쪽으로 밀리는 버그가 초록 스위트
// 아래에서 살아남았다.
//
// 실제 측정값과 그 근거는 pdf-find-eol.ts 헤더에 있다. 요지: pdfjs는
// #calculateMatch에서 getOriginalIndex로 인덱스를 되돌린 뒤 배열에 넣고,
// 자신의 TextHighlighter는 그 오프셋을 순수 item.str 배열에 walk시킨다.
import type { EolTextItem } from "../pdf-find-eol";

import { describe, expect, it } from "vitest";

import { convertMatches } from "../pdf-find";
import { toDomainStrings, toEolItems } from "../pdf-find-eol";

describe("toDomainStrings", () => {
  it("is the plain item strings — hasEOL contributes NO synthetic entry", () => {
    const items: EolTextItem[] = [
      { hasEOL: true, str: "foo" },
      { hasEOL: false, str: "bar" },
    ];
    expect(toDomainStrings(items)).toEqual(["foo", "bar"]);
  });
});

// 실제 pdfjs 출력으로 고정한 회귀 케이스. 이 숫자들은 추론이 아니라
// 측정값이다(합성 PDF 1페이지, "alpha" 검색):
//   items       ["Baram find probe alpha"(hasEOL), "second line beta alpha"]
//   pageMatches [17, 39]  lengths [5, 5]
describe("match offsets after an EOL (the real-world regression)", () => {
  const items: EolTextItem[] = [
    { hasEOL: true, str: "Baram find probe alpha" },
    { hasEOL: false, str: "second line beta alpha" },
  ];
  const matches = [17, 39];
  const lengths = [5, 5];

  it("puts BOTH matches exactly on the word, not one char before it", () => {
    const positions = convertMatches(matches, lengths, toDomainStrings(items));
    expect(positions).toEqual([
      { begin: { divIdx: 0, offset: 17 }, end: { divIdx: 0, offset: 22 } },
      { begin: { divIdx: 1, offset: 17 }, end: { divIdx: 1, offset: 22 } },
    ]);
    // 도메인 문자열에서 실제로 잘라 보는 것이 이 테스트의 요점이다 — 숫자만
    // 맞추면 다음 사람이 왜 17인지 알 수 없다.
    const strs = toDomainStrings(items);
    for (const p of positions) {
      expect(strs[p.begin.divIdx].slice(p.begin.offset, p.end.offset)).toBe(
        "alpha",
      );
    }
  });

  it("MUTATION PROOF: re-inserting a synthetic newline shifts the SECOND match onto the space", () => {
    // 이전 구현이 하던 일을 그대로 재현한다.
    const withSynthetic: string[] = [];
    for (const item of items) {
      withSynthetic.push(item.str);
      if (item.hasEOL) withSynthetic.push("\n");
    }
    const positions = convertMatches(matches, lengths, withSynthetic);
    // 첫 매치는 EOL 앞이라 멀쩡하다 — 사용자가 "처음 찾아진 단어만 정확하다"고
    // 보고한 이유가 바로 이것이다.
    expect(
      withSynthetic[positions[0].begin.divIdx].slice(
        positions[0].begin.offset,
        positions[0].end.offset,
      ),
    ).toBe("alpha");
    // 두 번째는 한 칸 앞으로 밀려 공백을 문다.
    expect(
      withSynthetic[positions[1].begin.divIdx].slice(
        positions[1].begin.offset,
        positions[1].end.offset,
      ),
    ).toBe(" alph");
  });

  it("drift grows with the number of preceding EOLs, so later matches are worse", () => {
    // EOL이 둘이면 세 번째 줄의 매치는 두 칸 밀린다 — 합성 항목이 둘 앞서므로.
    const three: EolTextItem[] = [
      { hasEOL: true, str: "aa alpha" }, // alpha at 3
      { hasEOL: true, str: "bb alpha" }, // domain 9..  -> alpha at 8+3 = 11
      { hasEOL: false, str: "cc alpha" }, // -> alpha at 16+3 = 19
    ];
    const strs = toDomainStrings(three);
    const positions = convertMatches([3, 11, 19], [5, 5, 5], strs);
    for (const p of positions) {
      expect(strs[p.begin.divIdx].slice(p.begin.offset, p.end.offset)).toBe(
        "alpha",
      );
    }
    expect(positions.map((p) => p.begin.divIdx)).toEqual([0, 1, 2]);
  });
});

describe("toEolItems", () => {
  it("keeps text items and their hasEOL flag", () => {
    expect(
      toEolItems([
        { hasEOL: true, str: "a" },
        { hasEOL: false, str: "b" },
      ]),
    ).toEqual([
      { hasEOL: true, str: "a" },
      { hasEOL: false, str: "b" },
    ]);
  });

  it("defaults a missing hasEOL to false rather than undefined", () => {
    expect(toEolItems([{ str: "a" }])).toEqual([{ hasEOL: false, str: "a" }]);
  });

  it("skips TextMarkedContent entries, which carry no string at all", () => {
    expect(
      toEolItems([{ str: "a" }, { type: "beginMarkedContent" }, { str: "b" }]),
    ).toEqual([
      { hasEOL: false, str: "a" },
      { hasEOL: false, str: "b" },
    ]);
  });

  it("skips non-object and null entries without throwing", () => {
    expect(toEolItems([null, undefined, 42, "nope", { str: "a" }])).toEqual([
      { hasEOL: false, str: "a" },
    ]);
  });

  it("skips an item whose str is not a string", () => {
    expect(toEolItems([{ str: 5 }, { str: "a" }])).toEqual([
      { hasEOL: false, str: "a" },
    ]);
  });
});

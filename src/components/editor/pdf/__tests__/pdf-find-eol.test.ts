import type { EolTextItem } from "../pdf-find-eol";

// §272 EOL 오프셋 보정 테스트 — FindController 도메인(합성 "\n" 포함)과
// TextLayer 도메인(textDivs, 합성 항목 없음) 사이의 인덱스 변환을 검증한다.
import { describe, expect, it } from "vitest";

import { convertMatches } from "../pdf-find";
import { buildEolDomain, convertMatchesWithEol } from "../pdf-find-eol";

// FindController 도메인 문자열: "foo" + 합성 "\n" + "bar" + "baz" = "foo\nbarbaz"
// textDivs 도메인: ["foo"(div0), "bar"(div1), "baz"(div2)] — "\n"에 대응하는
// div는 없다. "bar"는 실제로 div1에 있지만, findController가 보고하는 오프셋
// 4는 합성 "\n"을 센 값이라 보정 없이는 다른 div로 잘못 떨어진다.
const items: EolTextItem[] = [
  { hasEOL: true, str: "foo" },
  { hasEOL: false, str: "bar" },
  { hasEOL: false, str: "baz" },
];
const matches = [4];
const matchesLength = [3];

describe("convertMatchesWithEol", () => {
  it("maps a match that falls after an EOL to the div the text actually lives in", () => {
    const positions = convertMatchesWithEol(matches, matchesLength, items);
    expect(positions).toEqual([
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 3 } },
    ]);
  });

  it("MUTATION PROOF: dropping the compensation breaks the previous assertion", () => {
    // 합성 "\n" 삽입과 toDivIdx 되돌림 없이, findController가 준 오프셋을 raw
    // item.str 배열에 그대로 흘려보내면(보정을 빼먹으면) divIdx가 어긋난다.
    const uncompensated = convertMatches(
      matches,
      matchesLength,
      items.map((i) => i.str),
    );
    expect(uncompensated).not.toEqual([
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 3 } },
    ]);
  });
});

describe("buildEolDomain", () => {
  it("builds a domain string with a synthetic newline after each hasEOL item", () => {
    const { domainItems } = buildEolDomain(items);
    expect(domainItems).toEqual(["foo", "\n", "bar", "baz"]);
  });

  it("maps real (non-synthetic) domain indices back to their textDivs index", () => {
    const { toDivIdx } = buildEolDomain(items);
    expect(toDivIdx(0)).toBe(0); // "foo"
    expect(toDivIdx(2)).toBe(1); // "bar"
    expect(toDivIdx(3)).toBe(2); // "baz"
  });

  it("clamps a divIdx landing exactly on a synthetic entry to a real, non-negative div", () => {
    const { toDivIdx } = buildEolDomain(items);
    // domain index 1 is the synthetic "\n" itself — there is no textDivs[1]
    // for it. toDivIdx must not return that phantom index.
    const clamped = toDivIdx(1);
    expect(clamped).toBeGreaterThanOrEqual(0);
    expect(clamped).toBeLessThan(items.length);
  });

  it("never returns a negative index even for index 0 with a leading EOL", () => {
    const leading: EolTextItem[] = [
      { hasEOL: true, str: "a" },
      { hasEOL: false, str: "b" },
    ];
    const { toDivIdx } = buildEolDomain(leading);
    expect(toDivIdx(0)).toBe(0);
    expect(toDivIdx(0)).toBeGreaterThanOrEqual(0);
  });
});

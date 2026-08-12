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
    // 합성 "\n" 삽입과 toDivPosition 되돌림 없이, findController가 준 오프셋을
    // raw item.str 배열에 그대로 흘려보내면(보정을 빼먹으면) divIdx가 어긋난다.
    const uncompensated = convertMatches(
      matches,
      matchesLength,
      items.map((i) => i.str),
    );
    expect(uncompensated).not.toEqual([
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 3 } },
    ]);
  });

  // §272 Fix round 1 — I3: 매치가 합성 "\n" 경계에 정확히 걸치면(예: 쿼리가
  // 공백으로 시작해 "\n" 자체와 매치되는 경우) offset을 그대로 옮기면 안 된다.
  // "foo\nbarbaz"에서 인덱스3, 길이4 = "\nbar"(정확히 "\n" 시작 + "bar" 전체).
  it("resolves a match landing exactly on the synthetic EOL to the previous div's end, not its start", () => {
    const positions = convertMatchesWithEol([3], [4], items);
    // begin이 합성 항목(도메인 idx1) 자체에 떨어진다 — "foo"는 매치되지
    // 않았으므로 div0(foo)의 끝(offset 3 = len("foo"))으로 고정돼야 한다.
    // (offset을 그대로 옮기면 0이 되어 "foo" 전체가 잘못 칠해진다 — I3.)
    expect(positions).toEqual([
      { begin: { divIdx: 0, offset: 3 }, end: { divIdx: 1, offset: 3 } },
    ]);
  });
});

describe("buildEolDomain", () => {
  it("builds a domain string with a synthetic newline after each hasEOL item", () => {
    const { domainItems } = buildEolDomain(items);
    expect(domainItems).toEqual(["foo", "\n", "bar", "baz"]);
  });

  it("maps real (non-synthetic) domain indices back to their textDivs index, offset unchanged", () => {
    const { toDivPosition } = buildEolDomain(items);
    expect(toDivPosition(0, 1)).toEqual({ divIdx: 0, offset: 1 }); // "foo"
    expect(toDivPosition(2, 0)).toEqual({ divIdx: 1, offset: 0 }); // "bar"
    expect(toDivPosition(3, 2)).toEqual({ divIdx: 2, offset: 2 }); // "baz"
  });

  // §272 Fix round 1 — M2: 이전 버전은 범위만 확인해(`>=0 && <items.length`)
  // `if (s >= i) break`로 바꿔도 통과했다. 정확한 값을 고정한다 — domain
  // idx1은 "foo" 뒤에 삽입된 합성 "\n" 자체이고, 그 항목은 div0(foo)이
  // 만들었으므로 정확히 divIdx 0이어야 한다(1이 아니다).
  it("maps a divIdx landing exactly on a synthetic entry to the PRECEDING real div, offset = that div's length", () => {
    const { toDivPosition } = buildEolDomain(items);
    expect(toDivPosition(1, 0)).toEqual({ divIdx: 0, offset: 3 });
  });

  // §272 Fix round 1 — M2: 이전 버전은 자연 발생하는 입력으로는 절대
  // shift > i가 될 수 없어(합성 인덱스는 항상 그걸 만든 실제 항목보다 하나
  // 뒤이므로) Math.max(0, …)가 한 번도 실행되지 않았다. 클램프 자체를
  // 직접 확인하려면 계약 밖의 입력(음수 인덱스)으로 밀어붙여야 한다.
  it("clamps to 0 rather than going negative, even for an out-of-contract negative index", () => {
    const { toDivPosition } = buildEolDomain(items);
    expect(toDivPosition(-1, 0).divIdx).toBe(0);
  });
});

// §272 Fix round 2 — N2: 위 items 픽스처는 hasEOL이 딱 하나라서, "i 이전의
// 합성 개수"와 "배열 전체의 합성 총개수"가 같은 수가 된다 — 그래서 그 둘을
// 헷갈린(전체 개수를 쓰는) 잘못된 구현도 이 파일의 모든 테스트를 통과한다.
// hasEOL이 둘인 픽스처로 그 구분을 실제로 확인한다.
describe("convertMatchesWithEol — multiple EOLs (N2)", () => {
  // domain: "aa"(0) + 합성"\n"(1) + "bb"(2) + 합성"\n"(3) + "cc"(4)
  //       = "aa\nbb\ncc" (문자열 offset: a0 a1 \n2 b3 b4 \n5 c6 c7)
  const twoEolItems: EolTextItem[] = [
    { hasEOL: true, str: "aa" },
    { hasEOL: true, str: "bb" },
    { hasEOL: false, str: "cc" },
  ];

  it("resolves a match ending exactly on the SECOND synthetic boundary using the count of synthetics before it, not the total", () => {
    // "bb\n" — 문자열 offset 3, 길이 3(b,b,\n). end가 두 번째 합성 항목
    // (도메인 idx3) 자체에 정확히 떨어진다.
    const positions = convertMatchesWithEol([3], [3], twoEolItems);
    // begin(도메인 idx2, 실제 항목 "bb")은 이전 합성 1개만 세야 한다
    // (toRealDivIdx(2) = 2 - 1 = 1). 전체 개수(2)를 쓰면 2 - 2 = 0이 되어
    // "aa"(div0)로 잘못 떨어진다 — 이게 이 테스트가 잡는 버그다.
    expect(positions).toEqual([
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 2 } },
    ]);
  });
});

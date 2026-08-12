// §272 EOL 오프셋 보정 — findController 도메인과 텍스트 레이어 도메인의 차이를 메운다.
//
// PDFFindController는 텍스트를 추출할 때(pdf_viewer.mjs:6156-6163) 각 item.str
// 뒤에, item.hasEOL이면 합성 "\n" 문자를 하나 더 끼워 넣는다. 매치 오프셋은 그
// 늘어난 문자열을 기준으로 나온다. 반면 TextLayer의 textDivs(pdf.mjs:21309,
// 21376-21380)는 item당 정확히 하나의 div만 가지고 "\n" 항목은 전혀 없다 —
// hasEOL item은 그냥 <br>을 하나 더 붙일 뿐, 그 <br>은 textDivs에 들어가지
// 않는다. 그래서 findController가 보고하는 오프셋을 곧이곧대로 textDivs에
// 대응하는 텍스트 배열에 넣으면, 앞서 지나간 EOL 개수만큼 divIdx가 어긋난다.
//
// convertMatches(pdf-find.ts)는 pdfjs TextHighlighter의 충실한 포트로 남겨두고
// (앞선 태스크에서 그렇게 결정됨), 보정은 호출부인 이 모듈에서 한다.
import type { MatchPosition } from "./pdf-find";

import { convertMatches } from "./pdf-find";

/** convertMatches의 텍스트 도메인을 재구성하는 데 필요한 최소 표면. */
export interface EolTextItem {
  hasEOL?: boolean;
  str: string;
}

/**
 * findController와 같은 도메인 문자열 배열(hasEOL item마다 합성 "\n" 삽입)을
 * 만들고, 그 도메인의 (divIdx, offset) 좌표를 textDivs 좌표로 되돌리는
 * 함수를 함께 준다.
 *
 * 경계 사례 — divIdx가 합성 "\n" 항목 자체를 가리키는 경우: textDivs에는 그
 * 위치가 없다. 그 항목을 만든 **이전** 실제 div로 되돌리는 것만으론 부족하다
 * — offset을 그대로 들고 가면 안 된다. 길이 1인 합성 항목이라 그 위치에
 * 닿는 offset은 begin이면 항상 0, end면 항상 1(=합성 항목 전체 소비)뿐인데,
 * 이 값을 이전 div에 그대로 옮기면 begin은 그 div의 **시작**을, end는
 * "1글자만" 가리키게 되어 버린다 — 실제로는 둘 다 그 div의 **끝**(=EOL
 * 경계 자체)을 뜻한다. 그래서 여기서는 offset을 이전 div의 문자열 길이로
 * 대체한다: begin이 되면 `start === end === len`이라 renderMatches의
 * `end <= start` 가드가 그 div를 건너뛰고(= "foo" 자체는 매치되지 않았다는
 * 뜻이 정확히 반영됨) 다음 div부터 0에서 시작하고, end가 되면 그 div의
 * 끝까지 칠해진다(= "\n" 직전까지 전부 매치됐다는 뜻이 정확히 반영됨).
 */
export function buildEolDomain(items: readonly EolTextItem[]): {
  domainItems: string[];
  toDivPosition: (
    i: number,
    offset: number,
  ) => { divIdx: number; offset: number };
} {
  const domainItems: string[] = [];
  // 합성 "\n"이 들어간 domainItems 인덱스들 (오름차순).
  const syntheticAt: number[] = [];
  for (const item of items) {
    domainItems.push(item.str);
    if (item.hasEOL) {
      syntheticAt.push(domainItems.length);
      domainItems.push("\n");
    }
  }
  const syntheticSet = new Set(syntheticAt);

  // i가 합성 항목이 아니라고 가정했을 때의 실제 div 인덱스. i가 합성
  // 항목 자체라도 이 계산은 여전히 "그 항목을 만든 이전 실제 div"를 준다
  // (그 div 뒤에 삽입된 합성 항목까지 shift에 포함되므로).
  const toRealDivIdx = (i: number): number => {
    let shift = 0;
    for (const s of syntheticAt) {
      if (s > i) break; // syntheticAt는 오름차순이라 더 볼 필요 없다
      shift++;
    }
    return Math.max(0, i - shift);
  };

  const toDivPosition = (
    i: number,
    offset: number,
  ): { divIdx: number; offset: number } => {
    const divIdx = toRealDivIdx(i);
    if (syntheticSet.has(i)) {
      // 위 경계 사례: offset을 무시하고 이전 div의 끝으로 고정한다.
      return { divIdx, offset: items[divIdx].str.length };
    }
    return { divIdx, offset };
  };

  return { domainItems, toDivPosition };
}

/**
 * pageMatches/pageMatchesLength(findController 도메인의 원문 오프셋)를
 * textDivs 좌표의 MatchPosition[]으로 변환한다. convertMatches를
 * findController와 동일한 도메인(합성 "\n" 포함)으로 호출한 뒤, 결과의
 * (divIdx, offset)을 textDivs 좌표로 되돌린다.
 */
export function convertMatchesWithEol(
  matches: number[],
  matchesLength: number[],
  items: readonly EolTextItem[],
): MatchPosition[] {
  const { domainItems, toDivPosition } = buildEolDomain(items);
  const positions = convertMatches(matches, matchesLength, domainItems);
  return positions.map(({ begin, end }) => ({
    begin: toDivPosition(begin.divIdx, begin.offset),
    end: toDivPosition(end.divIdx, end.offset),
  }));
}

/**
 * page.getTextContent().items를 EolTextItem[]으로 좁힌다. includeMarkedContent
 * 를 안 쓰므로 이론상 전부 TextItem이어야 하지만, str이 없는 항목
 * (TextMarkedContent)은 방어적으로 건너뛴다. 파라미터를 unknown[]로 받는
 * 이유: pdfjs의 `TextItem | TextMarkedContent` 유니온을 곧바로
 * `{ hasEOL?; str? }` 같은 "전부 optional" 타입에 대입하면 TS가 두 타입에
 * 겹치는 프로퍼티가 하나도 없다고 보고 weak-type 오류를 낸다
 * (TextMarkedContent는 str/hasEOL이 전혀 없다) — 직접 unknown으로 받아
 * 런타임에 좁힌다.
 */
export function toEolItems(items: readonly unknown[]): EolTextItem[] {
  const result: EolTextItem[] = [];
  for (const item of items) {
    if (typeof item !== "object" || item === null || !("str" in item)) {
      continue;
    }
    const str = (item as { str: unknown }).str;
    if (typeof str !== "string") continue;
    const hasEOL = "hasEOL" in item ? Boolean(item.hasEOL) : false;
    result.push({ hasEOL, str });
  }
  return result;
}

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
 * 만들고, 그 도메인의 인덱스를 textDivs 인덱스로 되돌리는 함수를 함께 준다.
 *
 * 경계 사례 — divIdx가 합성 "\n" 항목 자체를 가리키는 경우: textDivs에는 그
 * 위치가 없으므로, 그 항목을 만든 **이전** 실제 div로 되돌린다(아래 shift
 * 계산이 자연히 그렇게 된다). offset은 그대로 넘긴다 — convertMatches는 항목
 * 하나가 통째로 시작/소비될 때만 정확히 이 경계에 닿으므로(길이 1인 합성
 * 항목이라 begin은 항상 offset 0, end는 항상 offset 1로 들어온다), 되돌린
 * div에서 그 offset이 "정확한" 시작/끝은 아닐 수 있다. EOL 경계에 정확히
 * 걸치는 매치는 드물고, 어긋나도 그 한 div 안에서 하이라이트가 살짝 짧아지거나
 * 길어질 뿐이다 — renderMatches의 `end <= start` 가드가 있어 다른 div를
 * 건드리거나 배열 밖을 읽지 않는다. toDivIdx는 음수를 반환하지 않는다.
 */
export function buildEolDomain(items: readonly EolTextItem[]): {
  domainItems: string[];
  toDivIdx: (i: number) => number;
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

  const toDivIdx = (i: number): number => {
    let shift = 0;
    for (const s of syntheticAt) {
      if (s > i) break; // syntheticAt는 오름차순이라 더 볼 필요 없다
      shift++;
    }
    return Math.max(0, i - shift);
  };

  return { domainItems, toDivIdx };
}

/**
 * pageMatches/pageMatchesLength(findController 도메인의 원문 오프셋)를
 * textDivs 좌표의 MatchPosition[]으로 변환한다. convertMatches를
 * findController와 동일한 도메인(합성 "\n" 포함)으로 호출한 뒤, 결과의
 * divIdx만 textDivs 도메인으로 되돌린다.
 */
export function convertMatchesWithEol(
  matches: number[],
  matchesLength: number[],
  items: readonly EolTextItem[],
): MatchPosition[] {
  const { domainItems, toDivIdx } = buildEolDomain(items);
  const positions = convertMatches(matches, matchesLength, domainItems);
  return positions.map(({ begin, end }) => ({
    begin: { divIdx: toDivIdx(begin.divIdx), offset: begin.offset },
    end: { divIdx: toDivIdx(end.divIdx), offset: end.offset },
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

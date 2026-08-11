// §272 PDF 내 찾기 — pdfjs PDFFindController 어댑터와 매치 위치 변환.

/** 텍스트 레이어 span 좌표로 표현된 매치 하나의 시작/끝. */
export interface MatchPosition {
  begin: { divIdx: number; offset: number };
  end: { divIdx: number; offset: number };
}

/**
 * findController의 원문 오프셋 매치를 텍스트 레이어 span 좌표로 변환한다.
 * pdfjs `TextHighlighter._convertMatches`(pdf_viewer.mjs:10920) 이식 —
 * 그 클래스가 번들에서 export되지 않기 때문이다.
 *
 * matches는 오름차순이라고 가정한다 (findController가 그렇게 만든다).
 */
export function convertMatches(
  matches: number[],
  matchesLength: number[],
  textItems: string[],
): MatchPosition[] {
  if (matches.length === 0 || textItems.length === 0) return [];

  const result: MatchPosition[] = [];
  const last = textItems.length - 1;
  let i = 0;
  let iIndex = 0;

  for (let m = 0; m < matches.length; m++) {
    let matchIdx = matches[m];
    while (i !== last && matchIdx >= iIndex + textItems[i].length) {
      iIndex += textItems[i].length;
      i++;
    }
    const begin = { divIdx: i, offset: matchIdx - iIndex };

    matchIdx += matchesLength[m];
    while (i !== last && matchIdx > iIndex + textItems[i].length) {
      iIndex += textItems[i].length;
      i++;
    }
    result.push({ begin, end: { divIdx: i, offset: matchIdx - iIndex } });
  }

  return result;
}

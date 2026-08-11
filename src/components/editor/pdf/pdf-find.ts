// §272 PDF 내 찾기 — pdfjs PDFFindController 어댑터와 매치 위치 변환.

/** 텍스트 레이어 span 좌표로 표현된 매치 하나의 시작/끝. */
export interface MatchPosition {
  begin: { divIdx: number; offset: number };
  end: { divIdx: number; offset: number };
}

/** PDFFindController가 뷰어에게 요구하는 최소 표면. */
export interface PdfLinkServiceAdapter {
  page: number;
  readonly pagesCount: number;
}

/**
 * findController의 원문 오프셋 매치를 텍스트 레이어 span 좌표로 변환한다.
 * pdfjs `TextHighlighter._convertMatches`(pdf_viewer.mjs:10920) 이식 —
 * 그 클래스가 번들에서 export되지 않기 때문이다.
 *
 * matches는 오름차순이라고 가정한다 (findController가 그렇게 만든다).
 *
 * 전제조건:
 * • matches는 오름차순 및 겹치지 않아야 한다. 각 매치는 이전 매치의 끝 이상에서
 *   시작해야 한다. PDFFindController가 그렇게 내보낸다. 겹치는 입력이 들어오면
 *   커서가 이미 후속 매치 시작을 지나 begin.offset이 음수가 될 수 있다.
 * • 오프셋은 클램핑되지 않는다. 루프가 마지막 항목에 도달하면 i !== last 가드가
 *   진행을 멈추므로 textItems.join("").length를 초과하는 매치 오프셋에 대해
 *   begin.offset과 end.offset 모두 최종 항목의 길이를 초과할 수 있다.
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

/**
 * PDFFindController용 linkService 어댑터.
 * `page` setter는 값을 저장하지 않고 스크롤로 위임한다 — 현재 페이지의
 * 진실은 스크롤 위치이지 이 객체가 아니다.
 */
export function createLinkService({
  getPage,
  pagesCount,
  scrollToPage,
}: {
  getPage: () => number;
  pagesCount: number;
  scrollToPage: (n: number) => void;
}): PdfLinkServiceAdapter {
  return {
    get page() {
      return getPage();
    },
    set page(n: number) {
      scrollToPage(n);
    },
    get pagesCount() {
      return pagesCount;
    },
  };
}

/**
 * pdfjs 뷰어 컴포넌트를 로드한다.
 *
 * ‼️ 정적 import 금지: pdf_viewer.mjs는 globalThis.pdfjsLib에서
 * 구조분해하는데(pdf_viewer.mjs:5033) 그 전역은 pdf.mjs가 평가될 때
 * 설정된다(pdf.mjs:34374). 두 모듈 사이에 의존 간선이 없어 정적 import는
 * 순서를 보장하지 못한다 — 순서가 뒤집히면 모듈 평가 시점에
 * "Cannot destructure property of undefined"로 죽는다.
 */
export async function loadPdfViewerModule() {
  await import("pdfjs-dist/legacy/build/pdf.mjs"); // globalThis.pdfjsLib 설정
  return import("pdfjs-dist/legacy/web/pdf_viewer.mjs");
}

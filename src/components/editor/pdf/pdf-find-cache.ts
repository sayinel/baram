// §272 Fix round 1 — I-B: 페이지별 매치 캐시 재계산을 순수 함수로 뺐다
// (React/pdfjs 타입에 의존하지 않는다). use-pdf-find.ts에 인라인으로 있을
// 때는 Correction 3(페이지별 currentIdx)과 Correction 5(안 바뀐 페이지의
// 객체 identity 유지)를 직접 단위 테스트할 방법이 없었다 — 이 함수는 그
// 둘을 pageMatches/selected/previous 캐시만으로 재현 가능하게 한다.
import type { MatchPosition } from "./pdf-find";
import type { EolTextItem } from "./pdf-find-eol";

import { convertMatches } from "./pdf-find";
import { toDomainStrings } from "./pdf-find-eol";

export interface PdfPageMatches {
  currentIdx: number;
  positions: MatchPosition[];
}

export interface RecomputePageMatchesInput {
  numPages: number;
  /** 캐시된 페이지별 텍스트 항목(hasEOL 포함) — 아직 못 받은 페이지는
   * 없는 키로 취급해 건너뛴다. */
  pageItems: ReadonlyMap<number, readonly EolTextItem[]>;
  /** findController.pageMatches — 인덱스 = pageIdx(0-based). */
  pageMatches: readonly (number[] | undefined)[];
  /** findController.pageMatchesLength — pageMatches와 같은 인덱싱. */
  pageMatchesLength: readonly (number[] | undefined)[];
  /** 이전 재계산의 캐시 — 안 바뀐 페이지는 이 참조를 그대로 들고 나간다. */
  previous: ReadonlyMap<number, PdfPageMatches>;
  /** findController.selected — 전역이 아니라 (pageIdx, matchIdx) 쌍. */
  selected: { matchIdx: number; pageIdx: number };
}

/**
 * pageMatches/pageMatchesLength(findController 도메인의 원문 오프셋)를
 * 페이지별 MatchPosition[]으로 변환해 캐시를 갱신한다.
 *
 * Correction 5: 실제로 바뀐 페이지(currentIdx 또는 positions)만 새 객체로
 * 교체하고, 안 바뀐 페이지는 previous의 객체 참조를 그대로 들고 간다 —
 * PdfPage의 `[matches]`-keyed effect가 안 바뀐 페이지에는 다시 안 그리도록.
 *
 * Correction 3: currentIdx는 findController의 selected가 **그 페이지**를
 * 가리킬 때만 채운다(전역 인덱스가 아니라 페이지별).
 */
export function recomputePageMatches({
  numPages,
  pageItems,
  pageMatches,
  pageMatchesLength,
  previous,
  selected,
}: RecomputePageMatchesInput): {
  cache: Map<number, PdfPageMatches>;
  changed: boolean;
} {
  const cache = new Map(previous);
  let changed = false;
  for (let idx = 0; idx < numPages; idx++) {
    const pageNumber = idx + 1;
    const items = pageItems.get(pageNumber);
    if (!items) continue;
    const matches = pageMatches[idx] ?? [];
    const matchesLength = pageMatchesLength[idx] ?? [];
    // §272.6 보정 없이 item.str 배열에 그대로 walk시킨다 — pdfjs 자신의
    // TextHighlighter._convertMatches와 같은 도메인이다. 합성 "\n"을 끼워
    // 넣던 이전 구현은 두 번째 매치부터 앞선 EOL 개수만큼 왼쪽으로 밀었다
    // (근거와 측정값은 pdf-find-eol.ts 헤더 참조).
    const positions = matches.length
      ? convertMatches(matches, matchesLength, toDomainStrings(items))
      : [];
    const pageCurrentIdx = selected.pageIdx === idx ? selected.matchIdx : -1;
    const prev = cache.get(pageNumber);
    if (
      prev &&
      prev.currentIdx === pageCurrentIdx &&
      samePositions(prev.positions, positions)
    ) {
      continue;
    }
    cache.set(pageNumber, { currentIdx: pageCurrentIdx, positions });
    changed = true;
  }
  return { cache, changed };
}

/** 두 MatchPosition[]이 필드 단위로 전부 같은지 본다 — length만 보면
 * offset-only 변화(예: I3의 EOL 경계 보정)를 놓친다. */
export function samePositions(
  a: readonly MatchPosition[],
  b: readonly MatchPosition[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((pos, i) => {
    const other = b[i];
    return (
      pos.begin.divIdx === other.begin.divIdx &&
      pos.begin.offset === other.begin.offset &&
      pos.end.divIdx === other.end.divIdx &&
      pos.end.offset === other.end.offset
    );
  });
}

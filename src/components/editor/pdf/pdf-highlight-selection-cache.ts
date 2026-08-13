// §274 popup 일관성 fix (round 4) — 모든 팝업 액션이 팝업을 닫게 되면서,
// Copy reference가 아직 색을 고르지 않은 선택에 대해 미리 만들어 둔 동반
// 노트 블록 id를 팝업 state 밖에서 기억해 둬야 한다. 안 그러면 팝업이
// 닫혔다 다시 열리는 사이에 "이미 블록이 있다"는 사실이 사라져
// createTextHighlight가 두 번째 문단을 만든다(§274 I2가 원래 막던 바로 그
// 결함) — use-pdf-highlights.ts의 PopupState.blockId 코멘트 참조.
import type { PdfRect } from "./pdf-highlight-geom";

/** 캐시 키를 만드는 데 필요한 선택의 최소 식별 정보. */
export interface PendingSelection {
  pageNumber: number;
  rects: readonly PdfRect[];
  text: string;
}

/**
 * "Copy reference"가 아직 색을 고르지 않은 선택에 대해 미리 만들어 둔
 * 동반 노트 블록 id를, 팝업이 닫혔다 다시 열려도 재사용할 수 있게 붙잡아
 * 둔다.
 *
 * 수명은 두 규칙으로 정한다:
 * - **문서가 바뀌면 `clear()`.** 다른 PDF(또는 vault)에서 민팅한 id를 이
 *   PDF의 선택에 재사용하면 안 된다 — use-pdf-highlights.ts는 사이드카
 *   경로가 바뀌는 바로 그 effect에서 이미 popup/sidecar를 리셋하므로, 같은
 *   자리에서 이 캐시도 비운다.
 * - **실제로 색이 입혀져 사이드카 하이라이트가 만들어지는 순간 `delete()`.**
 *   안 지우면 같은 선택을 다시 색칠할 때(재선택 뒤 색 고르기를 반복하는
 *   드문 경우) 같은 id를 가진 두 번째 사이드카 항목이 또 생긴다 — 문단은
 *   중복되지 않지만, id 중복 자체가 위에서 설명한 "둘이 하나처럼 취급되는"
 *   문제를 새로 만든다. 그래서 이 캐시엔 "참조만 복사됐고 아직 색은 안
 *   고른" 항목만 산다 — 세션 길이가 아니라 "지금 동시에 미결(pending)인
 *   선택이 몇 개인가"에 비례해 크기가 정해지므로 무한정 자라지 않는다.
 */
export class PendingRefBlockCache {
  private readonly map = new Map<string, string>();

  clear(): void {
    this.map.clear();
  }

  delete(sel: PendingSelection): void {
    this.map.delete(keyOf(sel));
  }

  get(sel: PendingSelection): null | string {
    return this.map.get(keyOf(sel)) ?? null;
  }

  set(sel: PendingSelection, blockId: string): void {
    this.map.set(keyOf(sel), blockId);
  }
}

/**
 * 키는 페이지 번호 + 선택 텍스트 + rect 전체를 모두 묶어 엄격하게 만든다.
 *
 * text만으로는 부족하다 — 같은 페이지에 같은 문구가 두 번 나오면(반복
 * 단어/구절) 서로 다른 두 위치의 선택이 우연히 같은 키로 뭉쳐 엉뚱한 블록
 * id를 재사용하게 된다. 그건 안전한 "미스"가 아니라 진짜 정합성 버그다 —
 * updateHighlightColor/deleteHighlightById는 하이라이트를 id 하나로만
 * 찾으므로(pdf-highlight-actions.ts), 두 하이라이트가 같은 id를 공유하면
 * 그 뒤로 색 변경/삭제가 어느 한쪽만 겨냥해도 둘 다에 적용된다.
 *
 * rects까지 포함하면 그런 오매칭은 구조적으로 불가능해진다 — 페이지 위의
 * 다른 위치는 정의상 다른 rects를 갖는다. 대신 반대 방향의 위험, 즉 "같은
 * 텍스트의 재선택인데 rects가 미세하게 달라 캐시가 놓치는" 경우가 생길 수
 * 있다(브라우저가 같은 Range를 다시 계산할 때 부동소수 서브픽셀이 흔들리는
 * 경우 — wkwebview-css-zoom-coords 메모 참고). 그건 안전한 실패다: 그냥
 * 새 id를 하나 더 만들 뿐이고(캐시가 아예 없던 오늘까지의 동작과 동일),
 * "다른 선택인데 같은 것으로 착각"하는 쪽보다 훨씬 낫다 — 엄격한 쪽으로
 * 치우친 설계다.
 */
function keyOf(sel: PendingSelection): string {
  const rectsKey = sel.rects
    .map((r) => [r.x, r.y, r.w, r.h].join(","))
    .join(";");
  return [sel.pageNumber, sel.text, rectsKey].join("|");
}

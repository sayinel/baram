// §282.2 레일의 하이라이트 목록.
//
// ‼️ 클릭 이동에는 새 코드가 없다. usePdfHighlightFlash가 이미
// `useLinkStore.pendingPdfHighlightId`를 지켜보다가 그 id를 이 PDF의 사이드카에서
// 찾아 페이지로 스크롤하고 잠깐 강조한다(§275.6 — 노트의 블록 참조를 클릭했을 때
// 쓰는 그 경로다). 목록 항목의 onClick은 그 스토어 값을 세우기만 하면 된다.
// 두 번째 점프 경로를 만들면 "어느 쪽이 진짜인가"가 생기고, 스크롤 대상 등록
// (pageElsRef)이 한 곳뿐이라는 §272의 전제도 흐려진다.
import { useMemo, useRef } from "react";

import type { StoredHighlight } from "./pdf-highlight-sidecar";
import type { PdfPageRetention } from "./pdf-page-retention";
import type { PDFPageProxy } from "pdfjs-dist";

import { useTranslation } from "../../../i18n/useTranslation";
import { useLinkStore } from "../../../stores/editor/link";
import { sortHighlightsForList } from "./pdf-highlight-list-order";
import { PdfHighlightListItem } from "./PdfHighlightListItem";
import { usePdfHighlightList } from "./use-pdf-highlight-list";
import { useRailRovingFocus } from "./use-rail-roving-focus";

export function PdfHighlightList({
  absCompanionPath,
  flashHighlightId,
  highlights,
  pages,
  retention,
}: {
  absCompanionPath: null | string;
  /** 방금 점프한 하이라이트 — 본문과 같은 항목을 목록에서도 짚어 준다. */
  flashHighlightId: null | string;
  highlights: StoredHighlight[];
  pages: PDFPageProxy[];
  /** §282.3 본문 페이지와 공유하는 렌더 캐시 레지스트리 — 그대로 항목에 넘긴다. */
  retention: PdfPageRetention;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  const pagesByNumber = useMemo(
    () => new Map(pages.map((p) => [p.pageNumber, p])),
    [pages],
  );

  // 사이드카는 생성 순서로 쌓인다 — 목록은 읽는 순서여야 한다. 정렬이
  // 뷰포트 공간에서 이뤄지므로(회전 페이지, pdf-highlight-list-order.ts 참조)
  // 페이지 프록시가 필요하다.
  const ordered = useMemo(
    () =>
      sortHighlightsForList(
        highlights,
        (pageNumber) =>
          pagesByNumber.get(pageNumber)?.getViewport({ scale: 1 }) ?? null,
      ),
    [highlights, pagesByNumber],
  );
  const items = usePdfHighlightList(ordered, absCompanionPath);

  // §282.4 페이지 목록과 같은 이유 — 목록 전체가 탭 정지점 하나여야 한다.
  // 기본 위치는 방금 점프한 항목(없으면 첫 줄)이다.
  const keys = useMemo(() => ordered.map((h) => h.id), [ordered]);
  const { onKeyDown, rovingKey } = useRailRovingFocus(
    keys,
    flashHighlightId,
    listRef,
    "data-pdf-highlight-id",
  );

  if (items.length === 0) {
    return (
      <p className="pdf-highlight-list-empty">
        {t("pdfSidePanel.noHighlights")}
      </p>
    );
  }

  return (
    <div className="pdf-highlight-list" onKeyDown={onKeyDown} ref={listRef}>
      {items.map((item) => (
        <PdfHighlightListItem
          isFlashing={item.highlight.id === flashHighlightId}
          item={item}
          key={item.highlight.id}
          onSelect={selectHighlight}
          page={pagesByNumber.get(item.highlight.page) ?? null}
          pageLabel={t("pdfSidePanel.pageLabel", {
            page: String(item.highlight.page),
          })}
          retention={retention}
          tabIndex={item.highlight.id === rovingKey ? 0 : -1}
        />
      ))}
    </div>
  );
}

function selectHighlight(highlightId: string): void {
  useLinkStore.getState().setPendingPdfHighlightId(highlightId);
}

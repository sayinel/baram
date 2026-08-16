// §282.2 레일의 하이라이트 목록.
//
// ‼️ 클릭 이동에는 새 코드가 없다. usePdfHighlightFlash가 이미
// `useLinkStore.pendingPdfHighlightId`를 지켜보다가 그 id를 이 PDF의 사이드카에서
// 찾아 페이지로 스크롤하고 잠깐 강조한다(§275.6 — 노트의 블록 참조를 클릭했을 때
// 쓰는 그 경로다). 목록 항목의 onClick은 그 스토어 값을 세우기만 하면 된다.
// 두 번째 점프 경로를 만들면 "어느 쪽이 진짜인가"가 생기고, 스크롤 대상 등록
// (pageElsRef)이 한 곳뿐이라는 §272의 전제도 흐려진다.
import { useMemo } from "react";

import type { StoredHighlight } from "./pdf-highlight-sidecar";
import type { PDFPageProxy } from "pdfjs-dist";

import { useTranslation } from "../../../i18n/useTranslation";
import { useLinkStore } from "../../../stores/editor/link";
import { sortHighlightsForList } from "./pdf-highlight-list-order";
import { PdfHighlightListItem } from "./PdfHighlightListItem";
import { usePdfHighlightList } from "./use-pdf-highlight-list";

export function PdfHighlightList({
  absCompanionPath,
  flashHighlightId,
  highlights,
  pages,
}: {
  absCompanionPath: null | string;
  /** 방금 점프한 하이라이트 — 본문과 같은 항목을 목록에서도 짚어 준다. */
  flashHighlightId: null | string;
  highlights: StoredHighlight[];
  pages: PDFPageProxy[];
}) {
  const { t } = useTranslation();

  // 사이드카는 생성 순서로 쌓인다 — 목록은 읽는 순서여야 한다
  // (pdf-highlight-list-order.ts의 y축 함정 참조).
  const ordered = useMemo(
    () => sortHighlightsForList(highlights),
    [highlights],
  );
  const items = usePdfHighlightList(ordered, absCompanionPath);

  const pagesByNumber = useMemo(
    () => new Map(pages.map((p) => [p.pageNumber, p])),
    [pages],
  );

  if (items.length === 0) {
    return (
      <p className="pdf-highlight-list-empty">
        {t("pdfSidePanel.noHighlights")}
      </p>
    );
  }

  return (
    <div className="pdf-highlight-list">
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
        />
      ))}
    </div>
  );
}

function selectHighlight(highlightId: string): void {
  useLinkStore.getState().setPendingPdfHighlightId(highlightId);
}

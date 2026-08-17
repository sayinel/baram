// §282.1 레일의 페이지 목록 — 썸네일 세로 스트립.
//
// 데이터는 새로 만들지 않는다: PdfPreview가 이미 모든 PDFPageProxy를 들고 있고
// (문서 로드 직후 doc.getPage를 전부 돈다), currentPage도 usePdfFind가 스크롤을
// rAF로 샘플링해 이미 계산하고 있으며, 클릭 이동도 같은 훅의 scrollToPage다.
// 이 컴포넌트가 새로 하는 일은 그리기와 "현재 페이지를 보이게 유지"뿐이다.
import { useEffect, useMemo, useRef } from "react";

import type { PdfPageRetention } from "./pdf-page-retention";
import type { PDFPageProxy } from "pdfjs-dist";

import { useTranslation } from "../../../i18n/useTranslation";
import { railContentWidth } from "./pdf-side-panel-utils";
import { PdfThumbnail } from "./PdfThumbnail";
import { useRailRovingFocus } from "./use-rail-roving-focus";

export function PdfPageList({
  currentPage,
  onSelectPage,
  pages,
  railRasterWidth,
  railWidth,
  retention,
}: {
  /** 1-based. usePdfFind가 스크롤에서 샘플링한 값 그대로. */
  currentPage: number;
  onSelectPage: (pageNumber: number) => void;
  pages: PDFPageProxy[];
  /** §283 캔버스를 그릴 때 쓸 레일 폭 — 드래그를 **놓았을 때만** 바뀐다.
   * 왜 라이브 폭과 갈라야 하는지는 use-pdf-rail-resize.ts 참조. */
  railRasterWidth: number;
  /** §283 레이아웃에 쓸 레일 폭 — 드래그 중 매 프레임 바뀐다. */
  railWidth: number;
  /** §282.3 본문 페이지와 공유하는 렌더 캐시 레지스트리 — 그대로 썸네일에 넘긴다. */
  retention: PdfPageRetention;
}) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);

  // §282.4 목록 전체를 탭 정지점 하나로 만든다 — 없으면 300페이지 문서에서
  // Tab을 300번 눌러야 레일을 빠져나온다.
  const keys = useMemo(() => pages.map((p) => String(p.pageNumber)), [pages]);
  const { onKeyDown, rovingKey } = useRailRovingFocus(
    keys,
    String(currentPage),
    listRef,
    "data-pdf-thumbnail",
  );

  // 본문을 스크롤하면 레일의 현재 썸네일도 따라와야 한다. `block: "nearest"`가
  // 핵심이다 — 이미 보이는 썸네일에는 아무 일도 하지 않으므로, 사용자가 레일을
  // 직접 스크롤해 다른 구간을 훑는 동안 그 스크롤을 빼앗지 않는다.
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-pdf-thumbnail="${String(currentPage)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [currentPage]);

  return (
    <div className="pdf-page-list" onKeyDown={onKeyDown} ref={listRef}>
      {pages.map((page) => (
        <PdfThumbnail
          isCurrent={page.pageNumber === currentPage}
          key={page.pageNumber}
          label={t("pdfSidePanel.pageLabel", {
            page: String(page.pageNumber),
          })}
          onSelect={onSelectPage}
          page={page}
          renderWidth={railContentWidth(railRasterWidth)}
          retention={retention}
          tabIndex={String(page.pageNumber) === rovingKey ? 0 : -1}
          width={railContentWidth(railWidth)}
        />
      ))}
    </div>
  );
}

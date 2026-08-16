// §282.1 레일의 페이지 목록 — 썸네일 세로 스트립.
//
// 데이터는 새로 만들지 않는다: PdfPreview가 이미 모든 PDFPageProxy를 들고 있고
// (문서 로드 직후 doc.getPage를 전부 돈다), currentPage도 usePdfFind가 스크롤을
// rAF로 샘플링해 이미 계산하고 있으며, 클릭 이동도 같은 훅의 scrollToPage다.
// 이 컴포넌트가 새로 하는 일은 그리기와 "현재 페이지를 보이게 유지"뿐이다.
import { useEffect, useRef } from "react";

import type { PDFPageProxy } from "pdfjs-dist";

import { PdfThumbnail } from "./PdfThumbnail";

/**
 * 썸네일 표시 폭(CSS px). 레일 폭(200) - 좌우 여백 - 스크롤바 여유.
 * 레일 폭을 바꾸면 이 값도 함께 봐야 한다 — CSS의 `.pdf-thumbnail-frame`은
 * 인라인 style로 크기를 받으므로 여기가 유일한 출처다.
 */
const THUMB_WIDTH_PX = 150;

export function PdfPageList({
  currentPage,
  onSelectPage,
  pages,
}: {
  /** 1-based. usePdfFind가 스크롤에서 샘플링한 값 그대로. */
  currentPage: number;
  onSelectPage: (pageNumber: number) => void;
  pages: PDFPageProxy[];
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

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
    <div className="pdf-page-list" ref={listRef}>
      {pages.map((page) => (
        <PdfThumbnail
          isCurrent={page.pageNumber === currentPage}
          key={page.pageNumber}
          onSelect={onSelectPage}
          page={page}
          width={THUMB_WIDTH_PX}
        />
      ))}
    </div>
  );
}

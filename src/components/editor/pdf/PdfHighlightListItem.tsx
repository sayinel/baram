// §282.2 하이라이트 목록의 한 줄 — 색 · 페이지 · 원문(또는 영역 크롭).
//
// 영역 하이라이트에 크롭이 필요한 이유: 두 종류 모두 동반 노트에 문단을 쓰지만
// (createTextHighlight를 area도 그대로 탄다), 그림 위에 그은 영역은 그 아래
// 텍스트가 없어 문단이 비어 있다. 그런 줄은 "5페이지"만 남아 무엇을 표시해
// 뒀는지 알 수 없다 — 영역 하이라이트의 주된 용도가 바로 그림이므로, 크롭이
// 곁다리가 아니라 그 줄의 내용이다.
import { memo, useEffect, useMemo, useRef, useState } from "react";

import type { HighlightListItem } from "./use-pdf-highlight-list";
import type { PDFPageProxy } from "pdfjs-dist";

import { computeAreaCropLayout } from "./pdf-area-crop";
import { pdfRectToPageLocal } from "./pdf-highlight-geom";
import { boundingPdfRect } from "./pdf-highlight-list-order";
import { PDF_RAIL_CONTENT_WIDTH_PX } from "./pdf-side-panel-utils";

/** 뷰포트 밖 이만큼까지 미리 그린다 (PdfThumbnail과 같은 값). */
const LAZY_ROOT_MARGIN = "200px";

// memo가 필요한 이유는 PdfThumbnail과 같다(그쪽 주석 참조) — 영역 드래그의
// raw mousemove가 PdfPreview 전체를 다시 렌더한다. 여기서는 `item`이 관건이라
// usePdfHighlightList가 그 배열을 메모해야 이 memo가 실제로 걸린다.
export const PdfHighlightListItem = memo(function PdfHighlightListItem({
  isFlashing,
  item,
  onSelect,
  page,
  pageLabel,
  tabIndex,
}: {
  /** 방금 이 항목으로 점프했는가 — 목록에서도 같은 항목을 짚어 준다. */
  isFlashing: boolean;
  item: HighlightListItem;
  onSelect: (highlightId: string) => void;
  /** 이 하이라이트가 있는 페이지의 프록시. 아직 로드 전이면 null(크롭 없이 그린다). */
  page: null | PDFPageProxy;
  /** 이미 번역된 페이지 라벨 — 이 컴포넌트는 i18n을 모른다(목록이 넘겨준다). */
  pageLabel: string;
  /** §282.4 roving tabindex — 페이지 목록과 같은 이유(그쪽 주석 참조). */
  tabIndex: number;
}) {
  const { highlight, text } = item;
  const isArea = highlight.kind === "area";
  const holderRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);

  // ‼️ 반드시 메모해야 한다. computeAreaCropLayout은 매번 **새 객체**를 돌려주므로
  // 아래 렌더 effect의 deps에 그대로 넣으면 리렌더마다 신원이 바뀌어
  // cancel → 다시 그리기가 무한히 반복된다(그림이 깜빡이고 워커가 쉬지 못한다).
  // highlight는 사이드카 state에서 온 안정된 참조라 deps로 쓸 수 있다.
  //
  // 크롭은 영역 하이라이트만. 텍스트 하이라이트는 원문이 곧 내용이고, 줄마다
  // rect가 흩어져 있어 그 상자를 잘라내면 무의미한 띠가 나온다.
  const layout = useMemo(() => {
    if (!isArea || !page) return null;
    const bounds = boundingPdfRect(highlight.rects);
    if (!bounds) return null;
    return computeAreaCropLayout({
      dpr: window.devicePixelRatio,
      maxCssWidth: PDF_RAIL_CONTENT_WIDTH_PX,
      pageLocalAtScale1: pdfRectToPageLocal(
        bounds,
        page.getViewport({ scale: 1 }),
      ),
      // ‼️ 레일의 크롭은 확대되지 않으므로 백킹 목표를 레일 폭으로 낮춘다 —
      // 기본값(900)이면 150px 자리에 ~36배 픽셀을 그린다(§276.6 참조).
      // 정확히는 "표시 폭과 같다"가 아니라 **상한**이다: 이보다 좁은 크롭은
      // cssWidth가 더 작으므로 여전히 조금 과하게 그린다(리뷰 M6). 그 오차는
      // 좁은 크롭에서만 생기고 절대 크기가 작아 지금은 받아들인다.
      renderTargetCssWidth: PDF_RAIL_CONTENT_WIDTH_PX,
    });
  }, [highlight, isArea, page]);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries[0]?.isIntersecting ?? false),
      { rootMargin: LAZY_ROOT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // PdfThumbnail과 같은 계약: 캔버스는 보일 때만 마운트되고(아래 JSX), 이
  // effect는 그때 돌아 그리며, 사라질 때 cleanup이 렌더를 취소한다.
  useEffect(() => {
    if (!layout || !page) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = layout.canvasWidth;
    canvas.height = layout.canvasHeight;
    const task = page.render({
      canvas,
      viewport: page.getViewport({
        offsetX: layout.offsetX,
        offsetY: layout.offsetY,
        scale: layout.renderScale,
      }),
    });
    task.promise.catch(() => {
      // 스크롤 이탈/언마운트로 취소됨 — 정상 경로
    });
    return () => task.cancel();
  }, [layout, page, visible]);

  return (
    <button
      className={[
        "btn-unstyled",
        "pdf-highlight-item",
        `pdf-highlight-item-${highlight.color}`,
        isFlashing ? "flashing" : null,
      ]
        .filter(Boolean)
        .join(" ")}
      data-pdf-highlight-id={highlight.id}
      onClick={() => onSelect(highlight.id)}
      ref={holderRef}
      tabIndex={tabIndex}
      type="button"
    >
      <span className="pdf-highlight-item-meta">
        {/* ‼️ .pdf-hl-path-* 를 재사용할 수 없다 — 그 클래스는 `fill:`만
            세우고 fill은 SVG 전용이라 HTML span에서는 아무 효과가 없다.
            처음엔 그걸 재사용했고, 결과는 모든 줄에 투명한 10×10 상자였다
            (색이 목록의 요점인데 색이 없었다). 색 **토큰**은 오버레이와
            그대로 공유한다 — pdf-side-panel.css 참조. */}
        <span
          className={`pdf-highlight-item-swatch pdf-highlight-item-swatch-${highlight.color}`}
        />
        <span className="pdf-highlight-item-page">{pageLabel}</span>
      </span>

      {layout && (
        <span
          className="pdf-highlight-item-crop"
          style={{ height: layout.cssHeight, width: layout.cssWidth }}
        >
          {visible && <canvas ref={canvasRef} />}
        </span>
      )}

      {text !== null && <span className="pdf-highlight-item-text">{text}</span>}
    </button>
  );
});

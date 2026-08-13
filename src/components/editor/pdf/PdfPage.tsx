// §5.1 PDF 페이지 — canvas + 하이라이트 레이어 + 텍스트 레이어. 뷰포트
// 근처에서만 렌더한다.
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import type { MatchPosition } from "./pdf-find";
import type { PdfRect, ViewportLike } from "./pdf-highlight-geom";
import type { StoredHighlight } from "./pdf-highlight-sidecar";
import type { PdfSelectionPopupProps } from "./PdfSelectionPopup";
import type { PDFPageProxy } from "pdfjs-dist";

import { TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";

import { clearMatches, renderMatches } from "./pdf-find-render";
import { pdfRectToPageLocal } from "./pdf-highlight-geom";
import {
  attachTextLayerEndOfContent,
  detachTextLayerEndOfContent,
} from "./pdf-text-layer-selection";
import { PdfSelectionPopup } from "./PdfSelectionPopup";

/** 뷰포트 밖 이만큼까지 미리 렌더한다. */
const LAZY_ROOT_MARGIN = "800px";

export function PdfPage({
  flashHighlightId,
  highlights,
  matches,
  onPageMouseDown,
  page,
  popup,
  scale,
}: {
  /** §275.6 ref → PDF 점프가 방금 도착한 하이라이트 id — 이 페이지에 있으면
   * 잠깐 강조한다. 다른 id/페이지면 부모가 null을 내려준다. */
  flashHighlightId?: null | string;
  /** §274 이 페이지에 속한 하이라이트만 — 부모가 이미 page 번호로 걸러서 내려준다. */
  highlights?: StoredHighlight[];
  /** §272 찾기 매치 — 없으면 하이라이트를 지운다. */
  matches?: { currentIdx: number; positions: MatchPosition[] };
  /** §274 하이라이트 클릭 히트 테스트 — .pdf-page 좌표계로 페이지 번호와
   * viewport, 원점, 클릭 좌표를 그대로 넘긴다(변환은 부모 훅이 한다). */
  onPageMouseDown?: (
    pageNumber: number,
    viewport: ViewportLike,
    pageOrigin: { left: number; top: number },
    clientX: number,
    clientY: number,
  ) => void;
  page: PDFPageProxy;
  /** §274 이 페이지에 열린 선택 팝업. 다른 페이지의 팝업이면 부모가 null을 내려준다. */
  popup?: null | PdfSelectionPopupProps;
  scale: number;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const textDivsRef = useRef<HTMLElement[]>([]);
  // 텍스트 레이어가 (재)렌더를 마친 시점에 이미 활성 매치가 있을 수 있어
  // (마운트/줌 변경이 matches prop 변경과 동시에 일어나지 않는 경우) 항상
  // 최신값을 읽을 수 있도록 ref로도 들고 있는다.
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const [visible, setVisible] = useState(false);

  const viewport = page.getViewport({ scale });

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

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    const renderTask = page.render({
      canvas,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      viewport,
    });
    renderTask.promise.catch(() => {
      // 줌 변경/스크롤 이탈로 취소됨 — 정상 경로
    });
    return () => renderTask.cancel();
    // viewport는 (page, scale)에서 파생된다 — 아래 deps가 이를 포괄한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page, scale]);

  useEffect(() => {
    if (!visible) return;
    const container = textLayerRef.current;
    if (!container) return;
    container.replaceChildren();
    // §272.4 disableNormalization: PDFFindController가 같은 옵션으로 텍스트를
    // 추출한다(pdf_viewer.mjs:6134). 이 옵션이 빠지면 item 문자열이 달라져
    // 찾기 매치 오프셋이 어긋난다.
    const textLayer = new TextLayer({
      container,
      textContentSource: page.streamTextContent({
        disableNormalization: true,
      }),
      viewport,
    });
    let cancelled = false;
    textLayer
      .render()
      .then(() => {
        if (cancelled) return;
        textDivsRef.current = textLayer.textDivs;
        // 재렌더로 생긴 새 div에는 하이라이트가 없다 — 활성 매치가 있으면 즉시 다시 칠한다.
        const active = matchesRef.current;
        if (active) {
          renderMatches(
            textDivsRef.current,
            active.positions,
            active.currentIdx,
          );
        }
        // §274 UX fix round 3 (defect A) — pdf-text-layer-selection.ts 참조.
        // 렌더가 끝나 실제 span들이 갖춰진 지금이 pdf.js의 TextLayerBuilder가
        // endOfContent를 붙이는 것과 같은 시점이다.
        attachTextLayerEndOfContent(container);
      })
      .catch(() => {
        // 줌 변경/스크롤 이탈로 취소됨 — 정상 경로
      });
    return () => {
      cancelled = true;
      textDivsRef.current = [];
      textLayer.cancel();
      detachTextLayerEndOfContent(container);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page, scale]);

  // §272 matches가 바뀔 때마다 텍스트 레이어에 다시 칠한다.
  useEffect(() => {
    const divs = textDivsRef.current;
    if (matches) {
      renderMatches(divs, matches.positions, matches.currentIdx);
    } else {
      clearMatches(divs);
    }
  }, [matches]);

  // §274.2 하이라이트 클릭 히트 테스트는 .pdf-page의 mousedown에서 판정한다
  // — 하이라이트 레이어 자체는 pointer-events:none이라 이벤트를 못 받는다.
  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!onPageMouseDown) return;
    const pageEl = holderRef.current;
    if (!pageEl) return;
    const origin = pageEl.getBoundingClientRect();
    onPageMouseDown(page.pageNumber, viewport, origin, e.clientX, e.clientY);
  }

  return (
    <div
      className="pdf-page"
      onMouseDown={handleMouseDown}
      ref={holderRef}
      style={
        {
          // TextLayer가 폰트 메트릭 계산에 읽는다 (PDF.js v5+)
          "--total-scale-factor": String(viewport.scale),
          height: viewport.height,
          width: viewport.width,
        } as CSSProperties
      }
    >
      {visible && (
        <>
          <canvas ref={canvasRef} />
          {/* §274.2 캔버스와 텍스트 레이어 사이 — 순수 시각 오버레이라
              텍스트 선택/Cmd+C를 방해하지 않는다. */}
          <div className="pdf-highlight-layer">
            {highlights?.map((h) =>
              h.rects.map((r: PdfRect, i) => {
                const local = pdfRectToPageLocal(r, viewport);
                const flashing = h.id === flashHighlightId;
                return (
                  <div
                    className={
                      flashing
                        ? `pdf-hl-mark pdf-hl-mark-${h.color} pdf-hl-mark-flash`
                        : `pdf-hl-mark pdf-hl-mark-${h.color}`
                    }
                    key={`${h.id}-${i}`}
                    style={{
                      height: local.height,
                      left: local.left,
                      top: local.top,
                      width: local.width,
                    }}
                  />
                );
              }),
            )}
          </div>
          <div className="pdf-text-layer" ref={textLayerRef} />
          {popup && <PdfSelectionPopup {...popup} />}
        </>
      )}
    </div>
  );
}

// §5.1 PDF 페이지 — canvas + 텍스트 레이어. 뷰포트 근처에서만 렌더한다.
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import type { PDFPageProxy } from "pdfjs-dist";

import { TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";

/** 뷰포트 밖 이만큼까지 미리 렌더한다. */
const LAZY_ROOT_MARGIN = "800px";

export function PdfPage({
  page,
  scale,
}: {
  page: PDFPageProxy;
  scale: number;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
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
    textLayer.render().catch(() => {
      // 줌 변경/스크롤 이탈로 취소됨 — 정상 경로
    });
    return () => textLayer.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, page, scale]);

  return (
    <div
      className="pdf-page"
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
          <div className="pdf-text-layer" ref={textLayerRef} />
        </>
      )}
    </div>
  );
}

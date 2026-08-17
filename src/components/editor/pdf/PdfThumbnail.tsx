// §282.1 페이지 썸네일 하나 — 레일의 페이지 목록을 이루는 단위.
//
// PdfPage와 같은 지연 렌더 패턴을 쓰지만 훨씬 단순하다: 텍스트 레이어도,
// 하이라이트 레이어도, 찾기 매치도 없다. 캔버스 하나가 전부다.
//
// ‼️ 본문 페이지가 이미 렌더 중인 PDFPageProxy를 **같은 프록시 그대로** 다시
// 렌더한다. pdfjs 소스로 확인한 사실이다(legacy/build/pdf.mjs):
//   - `intentState.renderTasks`는 Set이다(22089) — 페이지당 동시 렌더가 허용된다
//   - 유일한 배타 가드(23243)는 페이지가 아니라 **캔버스 엘리먼트**를 키로 잡는
//     static Set이다. 캔버스가 다르면 충돌하지 않는다
//   - 같은 intent라 operator list를 공유한다 — 썸네일이 페이지를 다시 파싱하지
//     않는다는 뜻이라 오히려 이득이다
// 그래서 두 번째 문서 핸들(pdf-doc-cache.ts)을 열 이유가 없다. 그쪽은 **다른**
// PDF를 참조에서 그릴 때의 경로이고, 여기는 이미 열려 있는 그 문서다.
import { memo, useEffect, useRef, useState } from "react";

import type { PdfPageRetention } from "./pdf-page-retention";
import type { PDFPageProxy } from "pdfjs-dist";

/** 뷰포트(레일 본문 스크롤 포함) 밖 이만큼까지 미리 렌더한다. */
const LAZY_ROOT_MARGIN = "200px";

/**
 * 백킹 해상도의 dpr 상한.
 *
 * 썸네일은 표시 크기가 고정(레일 폭)이라 크롭 프리뷰(pdf-area-crop.ts)처럼
 * 면적이 폭발하지 않는다 — 항목당 비용이 상수이므로 바이트 예산 LRU가 필요
 * 없고, 개수는 아래 IntersectionObserver가 이미 "보이는 것"으로 묶는다.
 * dpr만 조이는 이유는 Retina에서 2배가 4배 픽셀이기 때문이다.
 */
const MAX_THUMB_DPR = 2;

// ‼️ memo가 필요한 이유는 스크롤이 아니라 **영역 하이라이트 드래그**다.
// use-pdf-area-highlight.ts의 setDragPreview는 rAF 스로틀 없이 raw mousemove마다
// (초당 60~120회+) 새 객체로 state를 세우므로 React의 동일값 bailout이 걸리지
// 않고 PdfPreview 전체가 다시 렌더된다. memo가 없으면 그때마다 썸네일 N개의
// 본문이 전부 다시 실행된다(300페이지면 getViewport 300회 × 초당 100번).
// 캔버스가 다시 그려지지는 않지만(렌더 effect의 deps는 원시값이라 bailout된다)
// 순수한 낭비다. onSelect는 PdfPreview의 scrollToPage(useCallback, deps [])라
// 안정적이고 page/width/isCurrent도 실제로 바뀔 때만 바뀐다.
export const PdfThumbnail = memo(function PdfThumbnail({
  isCurrent,
  label,
  onSelect,
  page,
  retention,
  tabIndex,
  width,
}: {
  isCurrent: boolean;
  /** 이미 번역된 접근성 이름 — 없으면 버튼 이름이 그냥 "7"이라 무엇의 7인지
   * 읽히지 않는다. 이 컴포넌트는 i18n을 모른다(목록이 넘겨준다). */
  label: string;
  onSelect: (pageNumber: number) => void;
  page: PDFPageProxy;
  /** §282.3 페이지 렌더 캐시 수명 레지스트리 — PdfPage와 **같은 인스턴스**를
   * 받는다. 그래야 본문이 띄워 둔 페이지를 썸네일이 스크롤로 지나갔다는
   * 이유로 비우지 않는다. */
  retention: PdfPageRetention;
  /** §282.4 roving tabindex — 목록 전체가 탭 정지점 하나가 되도록 하나만 0이다. */
  tabIndex: number;
  /** 썸네일 표시 폭(CSS px). 높이는 페이지 종횡비로 정해진다. */
  width: number;
}) {
  const holderRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);

  // scale 1 뷰포트로 종횡비를 잡는다 — 회전은 pdfjs가 이미 반영해서 준다.
  const natural = page.getViewport({ scale: 1 });
  const scale = natural.width > 0 ? width / natural.width : 0;
  const height = Math.round(natural.height * scale);

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

  // 보이는 동안에만 캔버스를 들고 있는다. 300페이지 문서의 썸네일을 전부 유지하면
  // dpr 2에서 ~1.2MB × 300 = 368MB — 유휴 메모리 목표(<100MB) 전체를 혼자 넘긴다.
  // 되돌아왔을 때의 재렌더는 이 배율에서 싸고, operator list는 이미 캐시돼 있다.
  //
  // ‼️ 그 상한을 쥐고 있는 것은 아래 JSX의 `{visible && <canvas/>}`이지 이
  // effect가 아니다. 여기에 `!visible`을 한 번 더 적었더니 뮤테이션이 살아남았다
  // — 안 보일 때는 캔버스가 언마운트돼 canvasRef.current가 null이라 어차피
  // 아래에서 멎기 때문이다. 같은 성질을 두 곳에서 지키면 어느 쪽이 진짜인지
  // 알 수 없고, 뒤에 그것을 읽는 사람도 알 수 없다. visible은 조건이 아니라
  // **deps로만** 남긴다 — 캔버스가 마운트된 뒤에 이 effect가 다시 돌아야 하고,
  // 사라질 때는 cleanup이 렌더를 취소해야 하기 때문이다.
  useEffect(() => {
    if (scale <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_THUMB_DPR);
    const viewport = page.getViewport({ scale });
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    const release = retention.retain(page);
    const task = page.render({
      canvas,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      viewport,
    });
    task.promise.catch(() => {
      // 스크롤 이탈/언마운트로 취소됨 — 정상 경로 (PdfPage와 같다)
    });
    return () => {
      // ‼️ cancel() 다음에 release() — PdfPage와 같은 계약이다(그쪽 주석 참조).
      task.cancel();
      release();
    };
  }, [visible, page, scale, retention]);

  return (
    <button
      aria-current={isCurrent ? "true" : undefined}
      aria-label={label}
      className={["btn-unstyled", "pdf-thumbnail", isCurrent ? "active" : null]
        .filter(Boolean)
        .join(" ")}
      data-pdf-thumbnail={page.pageNumber}
      onClick={() => onSelect(page.pageNumber)}
      ref={holderRef}
      tabIndex={tabIndex}
      type="button"
    >
      {/* 캔버스가 아직 없어도 자리는 잡아 둔다 — 지연 렌더가 스크롤 위치를
          흔들지 않으려면 높이가 처음부터 확정돼 있어야 한다. */}
      <span className="pdf-thumbnail-frame" style={{ height, width }}>
        {visible && <canvas ref={canvasRef} />}
      </span>
      <span className="pdf-thumbnail-label">{page.pageNumber}</span>
    </button>
  );
});

// §5.1 PDF 페이지 — canvas + 하이라이트 레이어 + 텍스트 레이어. 뷰포트
// 근처에서만 렌더한다.
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import type { MatchPosition } from "./pdf-find";
import type { PdfRect, ViewportLike } from "./pdf-highlight-geom";
import type { LocalRect } from "./pdf-highlight-path";
import type { StoredHighlight } from "./pdf-highlight-sidecar";
import type { PdfPageRetention } from "./pdf-page-retention";
import type { PdfSelectionPopupProps } from "./PdfSelectionPopup";
import type { PDFPageProxy } from "pdfjs-dist";

import { TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";

import { clearMatches, renderMatches } from "./pdf-find-render";
import { pdfRectToPageLocal } from "./pdf-highlight-geom";
import { buildHighlightPath } from "./pdf-highlight-path";
import { isDeletedHighlight } from "./pdf-highlight-sidecar";
import {
  attachTextLayerEndOfContent,
  detachTextLayerEndOfContent,
} from "./pdf-text-layer-selection";
import { PdfSelectionPopup } from "./PdfSelectionPopup";

/** 뷰포트 밖 이만큼까지 미리 렌더한다. */
const LAZY_ROOT_MARGIN = "800px";

export function PdfPage({
  areaCaptureActive,
  dragPreview,
  flashHighlightId,
  highlights,
  matches,
  onPageMouseDown,
  page,
  pendingAreaRects,
  popup,
  renderScale,
  retention,
  scale,
}: {
  /** §276.3 영역 하이라이트 모드가 켜져 있거나 Alt가 눌려 있는 동안 true —
   * 텍스트 레이어를 pointer-events:none으로 만들어(pdf.css) 캔버스 위
   * 드래그를 텍스트 선택이 먼저 먹지 못하게 한다. */
  areaCaptureActive?: boolean;
  /** §276.3 이 페이지에서 진행 중인 영역 드래그의 페이지 로컬 미리보기
   * 사각형. 다른 페이지에서 드래그 중이면 부모가 null을 내려준다. */
  dragPreview?: LocalRect | null;
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
  /** §276.3.2 색이 아직 정해지지 않은 영역 초안의 PDF user space 사각형.
   * 드래그가 끝나면 dragPreview는 사라지므로, 팝업이 열려 있는 동안 "무엇을
   * 선택했는지"를 계속 보여주는 것은 이쪽이다. 다른 페이지의 초안이면
   * 부모가 null을 내려준다. */
  pendingAreaRects?: null | PdfRect[];
  /** §274 이 페이지에 열린 선택 팝업. 다른 페이지의 팝업이면 부모가 null을 내려준다. */
  popup?: null | PdfSelectionPopupProps;
  /** §280 캔버스를 래스터할 배율 — 줌 제스처가 멎은 뒤에야 `scale`을 따라온다
   * (use-settled-scale.ts). 레이아웃/텍스트/하이라이트는 `scale`을 쓴다. */
  renderScale: number;
  /** §282.3 페이지 렌더 캐시 수명 레지스트리 — 이 페이지를 그리는 동안
   * 붙잡아 다른 표면(썸네일·크롭)이 놓더라도 캐시가 유지되게 한다. */
  retention: PdfPageRetention;
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
  // §281.1 텍스트 레이어를 (visible, page)마다 한 번만 만들기 위한 배선 —
  // 빌드 effect가 최신 배율을 읽고, 배율 변경은 update()로만 반영한다.
  const textLayerObjRef = useRef<null | TextLayer>(null);

  // §281.2 텍스트 레이어도 캔버스와 같은 규칙을 따른다: **renderScale**로
  // 배치하고, 라이브 배율과의 차이는 컨테이너 CSS 변환으로 흡수한다.
  //
  // 측정 (핀치 1.4초): gesturechange 85개에 프레임 20장 = **14.7 FPS**,
  // 최악 프레임 202ms. `update()`는 페이지의 모든 span(논문이면 1,000~3,000개)을
  // 순회하며 스타일을 다시 쓰는데, 그것을 초당 63번 하고 있었다.
  //
  // 변환은 그 수천 번의 쓰기를 **한 번**으로 만든다. 정렬도 유지된다 —
  // .pdf-text-layer에는 이미 `transform-origin: 0 0`이 있고(pdf.css), 스팬은
  // 전부 `color: transparent`라 눈에 보이는 것은 찾기 매치 배경과 선택 영역인데
  // 둘 다 컨테이너와 함께 늘어난다.
  //
  // ‼️ `--total-scale-factor`도 renderScale로 내려야 한다. 그 변수의 유일한
  // 소비자는 텍스트 레이어 스팬의 font-size(pdf.css의 --text-scale-factor)이므로,
  // 배치 배율과 어긋나면 글자 크기만 라이브로 커지면서 위치와 맞지 않게 된다.
  const textScaleRatio = renderScale > 0 ? scale / renderScale : 1;
  // 빌드 effect는 deps에 배율이 없으므로 최신값을 ref로 읽는다.
  const renderScaleRef = useRef(renderScale);
  renderScaleRef.current = renderScale;

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

  // §280 캔버스는 **renderScale**로 그린다 — live `scale`이 아니다.
  //
  // `canvas.width = ...` 대입은 캔버스를 지운다. 전에는 이 효과가 매 줌
  // 이벤트마다 돌아서, 캔버스를 비우고 → 그리기 시작하고 → 다음 이벤트의
  // cleanup이 `renderTask.cancel()`로 그것을 취소했다. 그래서 핀치하는 동안
  // 페이지가 계속 비어 있었다. 이제 이 효과는 제스처가 멎은 뒤 한 번만 돈다.
  //
  // 그 사이에도 페이지는 보인다: `.pdf-page`의 width/height는 live viewport를
  // 따르고, `.pdf-page canvas { width:100%; height:100% }`가 마지막 래스터를
  // 그 크기로 늘려 그린다(덜 선명할 뿐이다).
  useEffect(() => {
    // ‼️ `!visible` 조기 반환을 두지 않는다 — 안 보이면 아래 JSX가 캔버스를
    // 언마운트해 canvasRef.current가 null이므로 다음 줄에서 어차피 멎는다. 같은
    // 성질을 두 곳에서 지키면 어느 쪽이 진짜인지 알 수 없고, 실제로 PdfThumbnail
    // 에서는 그 중복 가드에 뮤테이션이 살아남았다(그쪽 주석 참조). visible은
    // 조건이 아니라 **deps로만** 남긴다.
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderViewport = page.getViewport({ scale: renderScale });
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(renderViewport.width * dpr);
    canvas.height = Math.floor(renderViewport.height * dpr);
    // §282.3 그리는 동안 이 페이지의 렌더 캐시를 붙잡는다. 줌이 바뀌면 renderScale이
    // deps에 있어 놓았다가 즉시 다시 잡는다 — 그 틈에 보이는 페이지들이 서로를
    // 축출하지 않는 것은 레지스트리가 축출 판정을 마이크로태스크로 미루기 때문이다
    // (pdf-page-retention.ts의 #scheduleEviction). 여기서 지킬 것은 순서뿐이다.
    const release = retention.retain(page);
    const renderTask = page.render({
      canvas,
      transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      viewport: renderViewport,
    });
    renderTask.promise.catch(() => {
      // 줌 변경/스크롤 이탈로 취소됨 — 정상 경로
    });
    return () => {
      // ‼️ 순서가 계약이다 — cancel()이 renderTasks를 **동기로** 비우므로
      // 그 뒤의 cleanup()은 즉시 성공하고 pdfjs의 pendingCleanup 래치를
      // 남기지 않는다. 뒤집으면 래치가 남아, 나중에 끝나는 렌더가 방금 만든
      // 캐시를 대신 날린다(pdf-page-retention.ts 맨 위 참조).
      renderTask.cancel();
      release();
    };
  }, [visible, page, renderScale, retention]);

  // §281.1 텍스트 레이어는 (visible, page)마다 **한 번만** 만든다 — scale은
  // deps에 없다.
  //
  // 전에는 scale이 바뀔 때마다 `container.replaceChildren()`으로 레이어를 통째로
  // 재구축했다. 그것이 성능 문제이기 전에 **기능 결함**이었다: WKWebView 핀치의
  // 제스처 타깃이 텍스트 레이어 안의 <span>인데, 첫 gesturechange가 줌을 바꾸는
  // 순간 그 span이 DOM에서 사라져 웹뷰가 제스처를 중단한다.
  //
  // 측정 (2026-08-15, PDF 탭에서 첫 핀치부터 기록):
  //   tgt=SPAN            → gesturestart + gesturechange 1개, gestureend 없음.
  //                         이것이 반복 — 핀치가 한 스텝마다 끊긴다.
  //   tgt=pdf-text-layer  → gesturestart 1개 + gesturechange 약 390개 + gestureend.
  // 컨테이너(글자 사이 빈 공간) 위에서 시작한 제스처만 살아남았다는 뜻이다.
  // 마크다운 탭이 멀쩡했던 이유도 같다 — 거기선 CSS zoom만 바뀌고 DOM이 안 죽는다.
  //
  // 재구축을 없애면 줌 스텝마다 일어나던 텍스트 재추출(streamTextContent)도
  // 함께 사라진다.
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
      // ‼️ §281.2 배치 배율은 **renderScale**이다(라이브 scale이 아니다).
      // 라이브와의 차이는 컨테이너 변환이 흡수하므로, 여기서 라이브 배율로
      // 배치하면 변환이 이중으로 적용된다. deps에 배율이 없어 ref로 읽는다.
      viewport: page.getViewport({ scale: renderScaleRef.current }),
    });
    textLayerObjRef.current = textLayer;
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
      textLayerObjRef.current = null;
      textLayer.cancel();
      detachTextLayerEndOfContent(container);
    };
    // renderScaleRef는 매 렌더 갱신되는 ref라 deps에 넣을 값이 아니다.
  }, [visible, page]);

  // §281.1 배율 변경은 **재배치**로만 처리한다. pdfjs의 update()는 기존
  // #textDivs를 순회하며 각 div를 그 자리에서 다시 배치할 뿐 컨테이너를 비우지
  // 않는다(legacy/build/pdf.mjs의 update 구현 확인). 그래서 진행 중인 핀치
  // 제스처의 타깃 span이 살아남는다.
  useEffect(() => {
    textLayerObjRef.current?.update({
      viewport: page.getViewport({ scale: renderScale }),
    });
  }, [page, renderScale]);

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
          // TextLayer가 폰트 메트릭 계산에 읽는다 (PDF.js v5+).
          // ‼️ §281.2 **renderScale**이다 — 이 변수의 유일한 소비자는 텍스트
          // 레이어 스팬의 font-size이고(pdf.css), 그 스팬들은 renderScale로
          // 배치돼 있다. 라이브 배율을 내리면 글자 크기만 커져 위치와 어긋난다.
          "--total-scale-factor": String(renderScale),
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
            {/* §274 UX fix round 3 (defect B) — 하이라이트 하나당 rect들을
                모두 하나의 SVG <path>로 합쳐 그린다(pdf-highlight-path.ts
                doc comment 참조) — 인접한 두 줄의 rect가 세로로 겹쳐도
                반투명 배경이 두 번 칠해지지 않는다. */}
            {highlights?.map((h) => {
              const localRects = h.rects.map((r: PdfRect) =>
                pdfRectToPageLocal(r, viewport),
              );
              return (
                <svg
                  className="pdf-hl-svg"
                  height={viewport.height}
                  key={h.id}
                  width={viewport.width}
                >
                  <path
                    // §276.3의 같은 이유로 배열 join이다 — 조건부 클래스의
                    // 공백을 템플릿 리터럴에 맡기지 않는다.
                    className={[
                      "pdf-hl-path",
                      `pdf-hl-path-${h.color}`,
                      // §277.2 삭제된 하이라이트가 여기까지 오는 경우는 하나뿐
                      // ("지금 강조 중" — use-pdf-highlights.ts의
                      // getPageHighlights). 채우지 않고 점선 윤곽만 그려
                      // "여기 있었다"로 읽히게 한다. 살아 있는 것과 같은
                      // 모습이면 사용자는 삭제가 안 됐다고 읽는다.
                      isDeletedHighlight(h) ? "pdf-hl-path-deleted" : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    d={buildHighlightPath(localRects)}
                    fillRule="nonzero"
                  />
                </svg>
              );
            })}
            {/* §275.6 ref 클릭 도착 강조 — 배경은 위 SVG가 이미 칠했으니
                여기서는 outline 링만 얹는다. 별도 레이어라 defect B의 union
                방식과 무관하게 항상 원래 밝기로 보인다. */}
            {highlights
              ?.filter((h) => h.id === flashHighlightId)
              .flatMap((h) =>
                h.rects.map((r: PdfRect, i) => {
                  const local = pdfRectToPageLocal(r, viewport);
                  return (
                    <div
                      className="pdf-hl-mark pdf-hl-mark-flash"
                      key={`${h.id}-flash-${i}`}
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
            {/* §276.3 드래그 중인 영역 하이라이트의 실시간 미리보기 — 저장된
                하이라이트가 아니므로 buildHighlightPath의 union 렌더링과는
                무관한 별도의(점선) 오버레이다. */}
            {dragPreview && (
              <div
                className="pdf-area-drag-preview"
                style={{
                  height: dragPreview.height,
                  left: dragPreview.left,
                  top: dragPreview.top,
                  width: dragPreview.width,
                }}
              />
            )}
            {/* §276.3.2 드래그를 놓은 뒤 색을 고르기 전까지 남는 초안 —
                dragPreview와 **같은** 점선 스타일을 쓴다. 드래그 중과 팝업이
                열린 뒤의 모습이 이어져 보여야 "선택이 유지되고 있다"로
                읽힌다. 드래그가 진행 중일 때는 dragPreview가 이미 같은 자리를
                그리므로 둘이 동시에 나오지 않는다(초안은 mouseup 이후에만
                생긴다). */}
            {!dragPreview &&
              pendingAreaRects?.map((r, i) => {
                const local = pdfRectToPageLocal(r, viewport);
                return (
                  <div
                    className="pdf-area-drag-preview"
                    key={`pending-area-${String(i)}`}
                    style={{
                      height: local.height,
                      left: local.left,
                      top: local.top,
                      width: local.width,
                    }}
                  />
                );
              })}
          </div>
          <div
            // §276.3 조건부 클래스는 배열 join으로 조립한다 — 템플릿
            // 리터럴의 삼항 분기 안에 넣은 앞공백은 prettier 재포맷에서
            // 조용히 사라질 수 있다(PdfSelectionPopup.tsx의 같은 코멘트,
            // prettier-tailwind-classname-whitespace-trim 메모 참조).
            className={[
              "pdf-text-layer",
              areaCaptureActive ? "pdf-text-layer-inert" : null,
            ]
              .filter(Boolean)
              .join(" ")}
            ref={textLayerRef}
            // §281.2 라이브 배율과 레이아웃 배율의 차이를 변환 하나로 흡수한다.
            // 스팬 수천 개를 다시 배치하는 대신 컨테이너를 늘린다.
            style={
              textScaleRatio === 1
                ? undefined
                : { transform: `scale(${textScaleRatio})` }
            }
          />
          {popup && <PdfSelectionPopup {...popup} />}
        </>
      )}
    </div>
  );
}

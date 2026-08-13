// §5.1 PDF file viewer — renders pages in-app with PDF.js.
// The webview's native PDF plugin (iframe) can't be zoomed from the host:
// it keeps its own magnification (widening the frame only grows margins)
// and swallows keyboard focus, so Cmd+= never reaches the app. Rendering
// pages onto canvases instead makes the shared editor zoomLevel re-render
// pages sharply at the new scale, and every zoom input (Cmd+= / Cmd+- /
// Cmd+0, Ctrl+wheel, pinch) flows through useZoom exactly like the
// markdown editor. Pages render lazily as they approach the viewport.

import { memo, useCallback, useEffect, useRef, useState } from "react";

import { convertFileSrc } from "@tauri-apps/api/core";

import type { ViewportLike } from "./pdf-highlight-geom";
import type { PdfFindApi } from "./use-pdf-find";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

// The legacy build, NOT the modern one: pdfjs's modern build assumes
// bleeding-edge engine APIs (e.g. Map.prototype.getOrInsertComputed) that
// current WKWebView lacks — page.render() crashes at runtime. The legacy
// build ships core-js polyfills for those and supports the webview range
// our minimumSystemVersion (macOS 13) implies.
import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { logger } from "../../../utils/logger";
import { PdfPage } from "./PdfPage";
import { PdfToolbar } from "./PdfToolbar";
import { usePdfAreaHighlight } from "./use-pdf-area-highlight";
import { usePdfFind } from "./use-pdf-find";
import { usePdfHighlights } from "./use-pdf-highlights";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Horizontal breathing room around pages at zoom 1. */
const PAGE_GUTTER_PX = 24;

interface PdfPreviewProps {
  /** Absolute path of the .pdf file (must be inside an opened context). */
  filePath: string;
  /** §272 Whether the PDF find bar is open — drives PDFFindController lifecycle. */
  findOpen?: boolean;
  /** §272 Reports the live find API (matchCount/currentIdx/callbacks) upward so
   * App.tsx can render PdfFindBar as a sibling, mirroring FindReplaceBar. Pass
   * a stable setState setter here, not an inline arrow — this component is
   * memoized and an unstable callback identity would defeat that. */
  onFindApiChange?: (api: null | PdfFindApi) => void;
  /** §276.1 Toolbar's find-toggle button — flips the SAME `findOpen` state the
   * parent already owns (App.tsx), so there is one source of truth for
   * whether the find bar is open regardless of which control toggled it. */
  onToggleFind?: () => void;
  /** Bumped on external reloads — forces a re-fetch of the file. */
  refreshKey?: number;
  /** Accessible title for the viewer (file path or name). */
  title?: string;
}

/**
 * §272 Fix round 1 — I1: the per-page wrapper div is `display:contents` (no
 * layout box — required so it doesn't disturb `.pdf-preview`'s flex column,
 * pdf.css:11-20), so `getBoundingClientRect()`/`scrollIntoView()` on it are
 * always inert. `usePdfFind` needs the box-generating element the wrapper
 * renders — `PdfPage`'s own root `.pdf-page` div. Extracted as a pure
 * function (rather than inlined in the ref callback) because jsdom returns
 * zero rects for every element regardless of `display`, so the layout bug
 * itself is untestable — this at least pins that the registered element is
 * the wrapper's child, not the (boxless) wrapper.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function resolvePageBoxEl(
  wrapperEl: HTMLElement | null,
): HTMLElement | null {
  return (wrapperEl?.firstElementChild as HTMLElement | null) ?? null;
}

export const PdfPreview = memo(function PdfPreview({
  filePath,
  findOpen,
  onFindApiChange,
  onToggleFind,
  refreshKey,
  title,
}: PdfPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<null | PDFDocumentProxy>(null);
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [error, setError] = useState<null | string>(null);
  const [baseScale, setBaseScale] = useState(0);
  const zoomLevel = useSettingsStore((s) => s.zoomLevel);
  const rootPath = useFileStore((s) => s.rootPath);

  // Load the document via the asset: protocol; reload on external change
  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setPages([]);
    setError(null);
    const url = refreshKey
      ? `${convertFileSrc(filePath)}?v=${refreshKey}`
      : convertFileSrc(filePath);
    const task = getDocument({ url });
    task.promise.then(
      (loaded) => {
        if (!cancelled) setDoc(loaded);
      },
      (err: unknown) => {
        if (cancelled) return;
        logger.error("[PdfPreview] failed to load PDF:", err);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
      // Destroying the loading task also frees the document + worker memory
      void task.destroy();
    };
  }, [filePath, refreshKey]);

  // Fetch all page proxies (lightweight — no rendering yet)
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    (async () => {
      const loaded: PDFPageProxy[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        loaded.push(await doc.getPage(i));
      }
      if (!cancelled) setPages(loaded);
    })().catch((err: unknown) => {
      if (!cancelled) logger.error("[PdfPreview] failed to load pages:", err);
    });
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // Fit-width base scale at zoom 1, tracking container resizes.
  // Measure the SCROLL CONTAINER (parent), never .pdf-preview itself: that
  // element is width:max-content, so it grows with the pages it contains —
  // measuring it feeds the pages' own width back into baseScale, and any
  // zoomLevel > 1 then inflates itself through the ResizeObserver forever
  // (pages wider → container wider → larger baseScale → pages wider …).
  useEffect(() => {
    const el = containerRef.current?.parentElement;
    const first = pages[0];
    if (!el || !first) return;
    const update = () => {
      const avail = el.clientWidth - PAGE_GUTTER_PX * 2;
      if (avail > 0) {
        setBaseScale(avail / first.getViewport({ scale: 1 }).width);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pages]);

  // §272 스크롤 컨테이너를 호출 시점에 얻는다 — getPage/scrollToPage와 같은
  // 지연 평가 패턴(위 baseScale 측정과 동일한 요소를 재사용).
  const getScrollElement = useCallback(
    () => containerRef.current?.parentElement ?? null,
    [],
  );

  const pdfFind = usePdfFind({
    doc,
    getScrollElement,
    isOpen: findOpen ?? false,
    pages,
  });
  const {
    currentIdx,
    currentPage,
    getPageMatches,
    matchCount,
    onNext,
    onPrev,
    onQueryChange,
    registerPageEl,
    scrollToPage,
  } = pdfFind;

  // §272 findOpen/matchCount/currentIdx/콜백이 바뀔 때마다 부모(App.tsx)에게
  // 알려 PdfFindBar를 이 컴포넌트 바깥에서 그릴 수 있게 한다 — FindReplaceBar가
  // 마크다운 편집기 옆에 놓이는 것과 같은 구조.
  useEffect(() => {
    onFindApiChange?.({
      currentIdx,
      matchCount,
      onNext,
      onPrev,
      onQueryChange,
    });
    return () => onFindApiChange?.(null);
  }, [currentIdx, matchCount, onFindApiChange, onNext, onPrev, onQueryChange]);

  const scale = baseScale * zoomLevel;

  // §276 Task 12 — pageElsRef(usePdfFind)가 실제로 채워지는 시점과 정확히
  // 같다: scale>0 && pages.length>0일 때만 아래 JSX가 페이지 wrapper div를
  // 렌더한다(§272 Fix I1 주석 참조). 이 전에 scrollToPage를 부르면
  // pageElsRef.get(n)이 undefined라 조용히 no-op한다 — usePdfHighlightFlash가
  // 대상을 찾기도 전에 pendingPdfHighlightId를 소비해버리는 레이스를 막는다.
  const pagesReady = scale > 0 && pages.length > 0;

  const onNextPage = useCallback(() => {
    scrollToPage(Math.min(currentPage + 1, pages.length));
  }, [currentPage, pages.length, scrollToPage]);
  const onPrevPage = useCallback(() => {
    scrollToPage(Math.max(currentPage - 1, 1));
  }, [currentPage, scrollToPage]);

  // §274 사이드카 로드 + 히트 테스트 + 선택 팝업 배선. rootPath가 없으면
  // (vault 밖 단일 파일 모드) 내부적으로 비활성화된다.
  const {
    flashHighlightId,
    getPageHighlights,
    handlePageMouseDown,
    highlightsEnabled,
    onAreaHighlightDrawn,
    popupPage,
    popupProps,
    registerPageEl: registerHighlightPageEl,
  } = usePdfHighlights({
    filePath,
    pages,
    pagesReady,
    rootPath,
    scale,
    scrollToPage,
  });

  // §276.3 영역 하이라이트 — highlightsEnabled로 vault 밖에서는 완전히
  // 무력화한다(툴바 토글도 안 보이고 Alt+드래그도 아무 효과가 없다). 모드
  // 훅 자체는 vault 여부를 몰라도 된다 — 이 컴포넌트(합성 계층)가 그
  // 정책을 쥔다.
  const areaHighlight = usePdfAreaHighlight({
    onAreaHighlightDrawn,
  });
  const areaCaptureActive =
    highlightsEnabled && areaHighlight.areaCaptureActive;

  // §274.2 하이라이트 클릭은 언제나 먼저 판정한다 — 영역 모드가 켜져
  // 있어도 기존 하이라이트를 클릭하면 그 관리 팝업이 열려야 한다(모드를
  // 끄지 않고도 관리할 수 있어야 하므로). 그 클릭이 아무것도 맞히지
  // 못했을 때만(hitExisting === false), 영역 캡처가 활성이면 이 mousedown을
  // 드래그 시작으로도 본다 — 둘 다 같은 handlePageMouseDown을 부르므로
  // 모드가 꺼져 있을 때는 완전히 이전과 동일한 동작이다.
  const onPageMouseDown = useCallback(
    (
      pageNumber: number,
      viewport: ViewportLike,
      pageOrigin: { left: number; top: number },
      clientX: number,
      clientY: number,
    ) => {
      const hitExisting = handlePageMouseDown(
        pageNumber,
        viewport,
        pageOrigin,
        clientX,
        clientY,
      );
      if (!hitExisting && areaCaptureActive) {
        areaHighlight.onPageMouseDown(
          pageNumber,
          viewport,
          pageOrigin,
          clientX,
          clientY,
        );
      }
    },
    [areaCaptureActive, areaHighlight, handlePageMouseDown],
  );

  return (
    <div
      aria-label={title || "PDF preview"}
      className="pdf-preview"
      ref={containerRef}
      role="document"
    >
      {error ? (
        <div className="pdf-preview-error">{error}</div>
      ) : (
        pagesReady &&
        pages.map((page) => (
          <div
            data-pdf-page-number={page.pageNumber}
            key={page.pageNumber}
            ref={(el) => {
              const boxEl = resolvePageBoxEl(el);
              registerPageEl(page.pageNumber, boxEl);
              registerHighlightPageEl(page.pageNumber, boxEl);
            }}
            style={{ display: "contents" }}
          >
            <PdfPage
              areaCaptureActive={areaCaptureActive}
              dragPreview={
                areaHighlight.dragPreview?.pageNumber === page.pageNumber
                  ? areaHighlight.dragPreview.rect
                  : null
              }
              flashHighlightId={flashHighlightId}
              highlights={getPageHighlights(page.pageNumber)}
              matches={getPageMatches(page.pageNumber)}
              onPageMouseDown={onPageMouseDown}
              page={page}
              popup={popupPage === page.pageNumber ? popupProps : null}
              scale={scale}
            />
          </div>
        ))
      )}

      {/* §276.1 상주 툴바 — 항상 보인다. pagesReady 이전엔 pageCount가
          의미 없으므로 렌더하지 않는다. */}
      {!error && pagesReady && (
        <PdfToolbar
          areaMode={areaHighlight.areaMode}
          currentPage={currentPage}
          onNextPage={onNextPage}
          onPrevPage={onPrevPage}
          onToggleAreaMode={
            highlightsEnabled ? areaHighlight.toggleAreaMode : undefined
          }
          onToggleFind={() => onToggleFind?.()}
          pageCount={pages.length}
        />
      )}
    </div>
  );
});

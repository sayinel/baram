// §274 하이라이트 오버레이 + 선택 팝업 배선. PdfPreview가 소유한다 —
// use-pdf-find.ts와 같은 자리, 같은 책임 분리(사이드카/DOM 상태는 여기,
// 좌표 변환은 pdf-highlight-geom.ts, IPC 오케스트레이션은
// pdf-highlight-actions.ts/pdf-highlight-store.ts, 팝업 액션 자체의 동작은
// use-pdf-highlight-popup-actions.ts, "언제/무엇을 열지"는
// use-pdf-selection-popup.ts).
//
// 하이라이트는 vault 안에서만 지원한다(사이드카·동반 노트가 vault 상대
// 경로로 식별되므로) — pdfRelPath가 없으면(단일 파일 모드, 또는 vault
// 밖의 PDF) 조용히 비활성화된다.
import { useCallback, useEffect, useRef, useState } from "react";

import type { PdfRect, ViewportLike } from "./pdf-highlight-geom";
import type { Sidecar, StoredHighlight } from "./pdf-highlight-sidecar";
import type { PdfSelectionPopupProps } from "./PdfSelectionPopup";
import type { AreaDrawnPayload } from "./use-pdf-area-highlight";
import type { PopupState } from "./use-pdf-highlight-popup-actions";
import type { NewSelectionPayload } from "./use-pdf-selection-popup";
import type { PDFPageProxy } from "pdfjs-dist";

import { escapeBlockRefTarget } from "../../../pipeline/block-id";
import { relativeToRoot } from "../../../utils/path-utils";
import { hitTestTopmost } from "./pdf-highlight-hittest";
import { PendingRefBlockCache } from "./pdf-highlight-selection-cache";
import { companionPathFor, sidecarPathFor } from "./pdf-highlight-sidecar";
import { readSidecar } from "./pdf-highlight-store";
import { usePdfHighlightFlash } from "./use-pdf-highlight-flash";
import { usePdfHighlightPopupActions } from "./use-pdf-highlight-popup-actions";
import { usePdfSelectionPopup } from "./use-pdf-selection-popup";

const EMPTY_HIGHLIGHTS: StoredHighlight[] = [];

export function usePdfHighlights({
  filePath,
  pages,
  pagesReady,
  rootPath,
  scale,
  scrollToPage,
  textModeActive,
}: {
  filePath: string;
  pages: PDFPageProxy[];
  /** §275.6 True once PdfPreview's pages are registered and safe to scroll
   * to — gates usePdfHighlightFlash, see its own doc comment. */
  pagesReady: boolean;
  rootPath: null | string;
  scale: number;
  /** §275.6 The SAME scrollToPage usePdfFind hands the toolbar/find controller. */
  scrollToPage: (n: number) => void;
  /** §276.3.1 use-pdf-highlight-mode.ts의 `mode === "text"` — 그대로
   * usePdfSelectionPopup에 넘긴다(그 훅의 doc comment 참조). */
  textModeActive: boolean;
}): {
  /** §275.6 Set briefly after a ref click lands on this PDF — the highlight
   * to render with the flash affordance (PdfPage). */
  flashHighlightId: null | string;
  getPageHighlights: (pageNumber: number) => StoredHighlight[];
  /** §274.2 하이라이트 클릭 히트 테스트 + "바깥 클릭으로 닫기". §276.3부터
   * 존재하는 하이라이트를 맞혔는지(true)를 돌려준다 — PdfPreview가 이
   * 값으로 "이 mousedown을 영역 드래그 시작으로도 볼지"를 정한다(맞혔으면
   * 관리 팝업이 이미 열렸으니 드래그를 시작하지 않는다). */
  handlePageMouseDown: (
    pageNumber: number,
    viewport: ViewportLike,
    pageOrigin: { left: number; top: number },
    clientX: number,
    clientY: number,
  ) => boolean;
  /** §276.3 하이라이트가 vault 상대 경로로 식별되므로 vault 밖/단일 파일
   * 모드에서는 false — PdfPreview가 영역 모드 토글을 숨기고 Alt+드래그를
   * 무효화하는 데 쓴다(§274의 "조용히 비활성화"와 같은 게이트). */
  highlightsEnabled: boolean;
  /** §276.3 영역 드래그가 끝났을 때(use-pdf-area-highlight.ts) 호출 —
   * onNewSelection과 정확히 같은 자리, highlightKind만 다르다. */
  onAreaHighlightDrawn: (payload: AreaDrawnPayload) => void;
  /** §276.3.2 색이 정해지기 전의 영역 초안(PDF user space). 팝업이 열려 있는
   * 동안 "무엇을 선택했는지"를 계속 보여주기 위한 것 — 텍스트 초안은 네이티브
   * 선택이 그 역할을 하므로 여기 들어오지 않는다. */
  pendingAreaRects: null | { pageNumber: number; rects: PdfRect[] };
  popupPage: null | number;
  popupProps: null | PdfSelectionPopupProps;
  registerPageEl: (pageNumber: number, el: HTMLElement | null) => void;
} {
  const [sidecar, setSidecar] = useState<null | Sidecar>(null);
  const [popup, setPopup] = useState<null | PopupState>(null);
  // §275.6 ref → PDF jump: once this PDF's own sidecar (below) has this
  // pending id, scroll + flash it.
  const { flashHighlightId } = usePdfHighlightFlash({
    pagesReady,
    scrollToPage,
    sidecar,
  });

  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map());
  const pagesByNumberRef = useRef<Map<number, PDFPageProxy>>(new Map());
  pagesByNumberRef.current = new Map(pages.map((p) => [p.pageNumber, p]));
  // §274 round 4 — Copy reference가 아직 색을 고르지 않은 선택에 대해 미리
  // 만들어 둔 동반 노트 블록 id를, 팝업이 닫혔다 다시 열려도 재사용할 수
  // 있게 붙잡아 둔다. onNewSelection(아래)이 읽고, use-pdf-highlight-popup-
  // actions.ts의 onCopyRef/onPickColor가 쓰고 지운다 — 세 곳 모두 같은
  // 인스턴스를 봐야 하므로 여기(공통 부모)에서 만들어 ref로 내려보낸다.
  // 자세한 설계(키 구성, 수명)는 그 모듈의 doc comment 참조.
  const pendingRefBlockCacheRef = useRef(new PendingRefBlockCache());

  const pdfRelPath = rootPath ? relativeToRoot(filePath, rootPath) : null;
  const absSidecarPath =
    rootPath && pdfRelPath ? `${rootPath}/${sidecarPathFor(pdfRelPath)}` : null;
  const absCompanionPath =
    rootPath && pdfRelPath
      ? `${rootPath}/${companionPathFor(pdfRelPath)}`
      : null;
  // §275.4 경로 한정 target — stem만으로는 highlights/ 아래 동명이인과 모호하다.
  // §275.4 CRITICAL-2 PDF 파일명은 그대로 여기 들어간다 — ")"·"#"·"|"를 담고
  // 있으면 escapeBlockRefTarget 없이는 BLOCK_REF_RE가 결과 문자열을 다시
  // 매치하지 못해 참조가 영원히 생텍스트로 남는다. 소비부(같은 escaping을
  // 되돌리는 쪽)는 pdfRelPathForHighlightTarget과 resolveWikilinkTarget.
  const target = pdfRelPath
    ? escapeBlockRefTarget(companionPathFor(pdfRelPath).replace(/\.md$/i, ""))
    : null;

  // PDF(또는 vault)가 바뀌면 해당 사이드카를 새로 읽고 열린 팝업을 닫는다.
  //
  // §275.6 M2: sidecar를 즉시(비동기 읽기 전에) 비운다 — 안 그러면 경로가
  // 바뀐 뒤 새 readSidecar가 아직 안 끝난 그 짧은 창에서 usePdfHighlightFlash가
  // 이전 PDF의 sidecar를 "이 PDF의 것"으로 읽는다. pendingPdfHighlightId가
  // 그 이전 sidecar에 우연히 없는 id면 조용히 소비되고 점프가 영영 사라진다
  // (있어도 잘못된 페이지로 스크롤한다). PdfPreview가 ref 클릭 시점에 항상
  // 언마운트돼 있어(App.tsx) 지금은 닿지 않는 경로지만, 그 전제가 바뀌면 이
  // 가드가 없으면 조용한 실패가 된다.
  //
  // §274 round 4: pendingRefBlockCacheRef도 같이 비운다 — 다른 문서(또는 다른
  // vault 안의 같은 상대경로 PDF, absSidecarPath는 rootPath까지 포함하니
  // 이 경우도 잡힌다)에서 민팅한 블록 id를 이 문서의 재선택이 이어받으면
  // 안 되기 때문이다.
  useEffect(() => {
    setPopup(null);
    setSidecar(null);
    pendingRefBlockCacheRef.current.clear();
    if (!absSidecarPath) return;
    let cancelled = false;
    void readSidecar(absSidecarPath).then((s) => {
      if (!cancelled) setSidecar(s);
    });
    return () => {
      cancelled = true;
    };
  }, [absSidecarPath]);

  const registerPageEl = useCallback(
    (pageNumber: number, el: HTMLElement | null) => {
      if (el) pageElsRef.current.set(pageNumber, el);
      else pageElsRef.current.delete(pageNumber);
    },
    [],
  );

  const getPageHighlights = useCallback(
    (pageNumber: number) =>
      sidecar?.highlights.filter((h) => h.page === pageNumber) ??
      EMPTY_HIGHLIGHTS,
    [sidecar],
  );

  // §274.2 하이라이트는 pointer-events:none이라 클릭은 .pdf-page의
  // mousedown에서 히트 테스트로 판정한다(PdfPage.tsx). 못 맞히면 열려있던
  // 팝업을 닫는다 — "바깥 클릭으로 닫기"를 이 한 판정으로 겸한다.
  //
  // §274 UX fix round 5 — 겹친 하이라이트는 배열 마지막(가장 최근 생성,
  // 화면에서 맨 위)이 잡혀야 한다. hitTestTopmost가 그 순서를 지킨다 — 왜
  // 그 순서인지는 pdf-highlight-hittest.ts의 doc comment 참조.
  //
  // §276.3 반환값(boolean, 맞혔는지)을 PdfPreview가 소비한다: 영역 캡처가
  // 활성이어도 기존 하이라이트를 맞힌 mousedown은 그 관리 팝업을 그대로
  // 열고 드래그를 시작하지 않는다 — 모드 중에도 기존 하이라이트를 클릭해
  // 관리할 수 있어야 하기 때문이다(모드를 끄지 않아도 된다).
  const handlePageMouseDown = useCallback(
    (
      pageNumber: number,
      viewport: ViewportLike,
      pageOrigin: { left: number; top: number },
      clientX: number,
      clientY: number,
    ): boolean => {
      const highlights = getPageHighlights(pageNumber);
      const [px, py] = viewport.convertToPdfPoint(
        clientX - pageOrigin.left,
        clientY - pageOrigin.top,
      );
      const hit = hitTestTopmost(highlights, { x: px, y: py });
      if (hit) {
        setPopup({
          anchor: {
            left: clientX - pageOrigin.left,
            top: clientY - pageOrigin.top,
          },
          existing: hit,
          kind: "existing",
          pageNumber,
        });
        return true;
      }
      setPopup(null);
      return false;
    },
    [getPageHighlights],
  );

  // §274.1 새 텍스트 선택 감지 — "언제 열지"(드래그 중엔 열지 않고, mouseup/
  // 키보드 선택엔 즉시 연다, §274 UX fix defect 1) + "구멍을 닫는" 기하
  // 병합(defect 2)은 use-pdf-selection-popup.ts로 옮겼다 — 이 파일이 500줄
  // 기준을 넘어서였다(그 파일 자체 doc comment 참조). 여기서는 결과를 받아
  // "new" kind로 popup state를 채우기만 한다.
  //
  // §274 round 4 — blockId를 무조건 null로 두지 않는다: 이 선택이 이전에
  // Copy reference로 이미 블록을 만들어 뒀던 바로 그 선택이면(팝업이 그
  // 사이 닫혔더라도) pendingRefBlockCacheRef가 그 id를 갖고 있다. 있으면
  // 재사용해, 팝업이 닫혔다 다시 열려도 §274 I2가 재발하지 않는다.
  const onNewSelection = useCallback((payload: NewSelectionPayload) => {
    const cached = pendingRefBlockCacheRef.current.get(payload);
    setPopup({
      ...payload,
      blockId: cached,
      highlightKind: "text",
      kind: "new",
    });
  }, []);
  usePdfSelectionPopup({
    onSelect: onNewSelection,
    pageElsRef,
    pagesByNumberRef,
    pdfRelPath,
    scale,
    textModeActive,
  });

  // §276.3 영역 드래그 완료 — onNewSelection과 같은 자리, highlightKind만
  // "area". 재드래그로 같은 rect가 나올 확률은 실질적으로 0이라(텍스트
  // 선택과 달리 부동소수 좌표가 그대로 재현되지 않는다) pendingRefBlockCacheRef를
  // 거치지 않는다 — Copy reference 후 다시 그려도 새 블록이 하나 더 생길
  // 뿐이고, 그건 서로 다른 두 영역 하이라이트를 만든 것과 같은 무해한
  // 결과다.
  const onAreaHighlightDrawn = useCallback((payload: AreaDrawnPayload) => {
    setPopup({
      anchor: payload.anchor,
      blockId: null,
      highlightKind: "area",
      kind: "new",
      pageNumber: payload.pageNumber,
      rects: payload.rects,
      text: payload.text,
    });
  }, []);

  const { onCopyRef, onCopyText, onDelete, onPickColor } =
    usePdfHighlightPopupActions({
      absCompanionPath,
      absSidecarPath,
      pdfRelPath,
      pendingRefBlockCacheRef,
      popup,
      setPopup,
      setSidecar,
      sidecar,
      target,
    });

  const popupProps: null | PdfSelectionPopupProps = popup
    ? {
        anchor: popup.anchor,
        existing: popup.kind === "existing" ? popup.existing : null,
        highlightKind:
          popup.kind === "existing" ? popup.existing.kind : popup.highlightKind,
        onCopyRef,
        onCopyText,
        onDelete,
        onPickColor,
      }
    : null;

  // §276.3.2 색이 정해지기 전의 영역 초안. 드래그를 놓는 순간
  // usePdfAreaHighlight의 dragPreview는 사라지는데, 그때까지 그려진 것이
  // 그것뿐이라 사용자에게는 "선택이 취소된 채 메뉴만 뜬" 것처럼 보였다.
  // 텍스트 쪽은 브라우저의 네이티브 선택이 팝업이 닫힐 때까지 남아 있어
  // 같은 문제가 없다 — 영역에도 같은 지속성을 준다.
  //
  // 텍스트 초안에는 일부러 주지 않는다: 네이티브 선택 위에 우리 사각형을
  // 겹쳐 그리면 같은 영역이 두 번 칠해진다.
  const pendingAreaRects: null | { pageNumber: number; rects: PdfRect[] } =
    popup && popup.kind === "new" && popup.highlightKind === "area"
      ? { pageNumber: popup.pageNumber, rects: popup.rects }
      : null;

  return {
    flashHighlightId,
    getPageHighlights,
    handlePageMouseDown,
    highlightsEnabled: pdfRelPath !== null,
    onAreaHighlightDrawn,
    pendingAreaRects,
    popupPage: popup?.pageNumber ?? null,
    popupProps,
    registerPageEl,
  };
}

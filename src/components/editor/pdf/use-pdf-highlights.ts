// §274 하이라이트 오버레이 + 선택 팝업 배선. PdfPreview가 소유한다 —
// use-pdf-find.ts와 같은 자리, 같은 책임 분리(사이드카/DOM 상태는 여기,
// 좌표 변환은 pdf-highlight-geom.ts, IPC 오케스트레이션은
// pdf-highlight-actions.ts/pdf-highlight-store.ts).
//
// 하이라이트는 vault 안에서만 지원한다(사이드카·동반 노트가 vault 상대
// 경로로 식별되므로) — pdfRelPath가 없으면(단일 파일 모드, 또는 vault
// 밖의 PDF) 조용히 비활성화된다.
import { useCallback, useEffect, useRef, useState } from "react";

import type { PdfRect, ViewportLike } from "./pdf-highlight-geom";
import type {
  HighlightColor,
  Sidecar,
  StoredHighlight,
} from "./pdf-highlight-sidecar";
import type { PdfSelectionPopupProps } from "./PdfSelectionPopup";
import type { PDFPageProxy } from "pdfjs-dist";

import { useTranslation } from "../../../i18n/useTranslation";
import {
  escapeBlockRefTarget,
  generateBlockId,
  serializeBlockRef,
} from "../../../pipeline/block-id";
import { useUIStore } from "../../../stores/ui/ui";
import { logger } from "../../../utils/logger";
import { relativeToRoot } from "../../../utils/path-utils";
import {
  addHighlightForExistingBlock,
  createTextHighlight,
  deleteHighlightById,
  updateHighlightColor,
} from "./pdf-highlight-actions";
import { clientRectToPdf } from "./pdf-highlight-geom";
import { findPageForNode, hitTestRects } from "./pdf-highlight-hittest";
import { companionPathFor, sidecarPathFor } from "./pdf-highlight-sidecar";
import {
  appendHighlightBlock,
  readHighlightBlockText,
  readSidecar,
} from "./pdf-highlight-store";
import { buildRefDisplay } from "./pdf-ref-display";
import { usePdfHighlightFlash } from "./use-pdf-highlight-flash";

const EMPTY_HIGHLIGHTS: StoredHighlight[] = [];

type PopupState =
  | {
      anchor: { left: number; top: number };
      /**
       * §274 I2 Copy reference가 이미 이 선택에 대해 동반 노트 블록을
       * 만들었으면 그 id. null이면 아직 아무것도 안 만들었다 — 색을 고르면
       * createTextHighlight(새 id)가, 이미 있으면 addHighlightForExistingBlock
       * (같은 id 재사용)이 갈린다. 이 필드가 없으면 Copy reference 뒤에 색을
       * 고를 때 두 번째 블록이 중복으로 생긴다.
       */
      blockId: null | string;
      kind: "new";
      pageNumber: number;
      rects: PdfRect[];
      text: string;
    }
  | {
      anchor: { left: number; top: number };
      existing: StoredHighlight;
      kind: "existing";
      pageNumber: number;
    };

export function usePdfHighlights({
  filePath,
  pages,
  pagesReady,
  rootPath,
  scale,
  scrollToPage,
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
}): {
  /** §275.6 Set briefly after a ref click lands on this PDF — the highlight
   * to render with the flash affordance (PdfPage). */
  flashHighlightId: null | string;
  getPageHighlights: (pageNumber: number) => StoredHighlight[];
  handlePageMouseDown: (
    pageNumber: number,
    viewport: ViewportLike,
    pageOrigin: { left: number; top: number },
    clientX: number,
    clientY: number,
  ) => void;
  popupPage: null | number;
  popupProps: null | PdfSelectionPopupProps;
  registerPageEl: (pageNumber: number, el: HTMLElement | null) => void;
} {
  const { t } = useTranslation();
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

  // §274 I1 사이드카/동반 노트 쓰기가 실패했는데 조용히 삼키면 §273.4가
  // 금지하는 바로 그 "조용한 부분 실패"가 된다 — main.tsx의 전역
  // unhandledrejection 핸들러가 콘솔 warn으로만 낮춰버려서, void로 던져둔
  // 실패는 사용자에게 아무 신호도 안 남긴다(§260 Phase 5 R4가 이미 같은
  // 교훈을 bootstrap()에 대해 기록해 두었다). 로그 + 토스트로 반드시 알린다.
  const reportWriteFailure = useCallback(
    (action: string, err: unknown) => {
      logger.error(`[pdf-highlight] ${action} failed:`, err);
      useUIStore.getState().showToast(t("pdfHighlight.saveFailed"), "error");
    },
    [t],
  );

  const reportCopyFailure = useCallback(
    (action: string, err: unknown) => {
      logger.error(`[pdf-highlight] ${action} failed:`, err);
      useUIStore.getState().showToast(t("pdfHighlight.copyFailed"), "error");
    },
    [t],
  );

  // 클립보드 API 자체의 실패(포커스 상실 등, 흔하고 저위험)는 warn만 남긴다 —
  // 텍스트/참조가 이미 준비된 뒤의 마지막 한 걸음이 실패한 것이라, 위
  // reportCopyFailure(토스트까지)보다 한 단계 낮게 다룬다.
  const reportClipboardFailure = useCallback((err: unknown) => {
    logger.warn("[pdf-highlight] clipboard write failed:", err);
  }, []);

  // PDF(또는 vault)가 바뀌면 해당 사이드카를 새로 읽고 열린 팝업을 닫는다.
  //
  // §275.6 M2: sidecar를 즉시(비동기 읽기 전에) 비운다 — 안 그러면 경로가
  // 바뀐 뒤 새 readSidecar가 아직 안 끝난 그 짧은 창에서 usePdfHighlightFlash가
  // 이전 PDF의 sidecar를 "이 PDF의 것"으로 읽는다. pendingPdfHighlightId가
  // 그 이전 sidecar에 우연히 없는 id면 조용히 소비되고 점프가 영영 사라진다
  // (있어도 잘못된 페이지로 스크롤한다). PdfPreview가 ref 클릭 시점에 항상
  // 언마운트돼 있어(App.tsx) 지금은 닿지 않는 경로지만, 그 전제가 바뀌면 이
  // 가드가 없으면 조용한 실패가 된다.
  useEffect(() => {
    setPopup(null);
    setSidecar(null);
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
  const handlePageMouseDown = useCallback(
    (
      pageNumber: number,
      viewport: ViewportLike,
      pageOrigin: { left: number; top: number },
      clientX: number,
      clientY: number,
    ) => {
      const highlights = getPageHighlights(pageNumber);
      const [px, py] = viewport.convertToPdfPoint(
        clientX - pageOrigin.left,
        clientY - pageOrigin.top,
      );
      const hit = highlights.find((h) =>
        hitTestRects(h.rects, { x: px, y: py }),
      );
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
      } else {
        setPopup(null);
      }
    },
    [getPageHighlights],
  );

  // §274.1 새 텍스트 선택 감지 — document 전역 selectionchange를 쓴다(개별
  // 페이지가 아니라): 드래그 도중 앵커가 어느 페이지에 속하는지 미리 알 수
  // 없기 때문이다. collapsed(단순 클릭으로 caret만 옮긴 경우)는 무시한다 —
  // 그 클릭은 이미 위 handlePageMouseDown이 처리했다(히트 또는 팝업 닫기).
  //
  // §274 M3 rootPath가 아니라 pdfRelPath로 게이팅한다 — vault는 열려 있는데
  // 이 PDF만 vault 밖에 있으면(relativeToRoot가 null) rootPath는 여전히
  // truthy라서, rootPath만 보면 팝업이 열려버린다. 그러면 사이드카/동반 노트
  // 경로가 전부 null이라 색을 고르거나 참조를 복사해도 아무 일도 안 일어나고
  // (아래 onPickColor/onCopyRef의 guard가 조용히 return), 팝업조차 안
  // 닫힌다 — 죽은 UI. pdfRelPath로 게이팅하면 그 상태에서는 애초에 열리지
  // 않는다.
  useEffect(() => {
    if (!pdfRelPath) return;

    function handleSelectionChange() {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const text = sel.toString();
      if (!text.trim()) return;

      const range = sel.getRangeAt(0);
      const found = findPageForNode(
        pageElsRef.current,
        range.commonAncestorContainer,
      );
      if (!found) return;
      const pageProxy = pagesByNumberRef.current.get(found.pageNumber);
      if (!pageProxy) return;

      const clientRects = Array.from(range.getClientRects());
      if (clientRects.length === 0) return;

      const viewport = pageProxy.getViewport({ scale });
      const origin = found.el.getBoundingClientRect();
      const rects = clientRects.map((r) =>
        clientRectToPdf(r, origin, viewport),
      );
      const last = clientRects[clientRects.length - 1];

      setPopup({
        anchor: {
          left: last.right - origin.left,
          top: last.bottom - origin.top,
        },
        blockId: null,
        kind: "new",
        pageNumber: found.pageNumber,
        rects,
        text,
      });
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [pdfRelPath, scale]);

  const onPickColor = useCallback(
    (color: HighlightColor) => {
      if (!popup || !absSidecarPath) return;
      if (popup.kind === "existing") {
        // sidecar가 null일 수는 없다 — popup.existing은 getPageHighlights가
        // 돌려준(즉 로드된 sidecar에서 온) 하이라이트라서다. 그래도 null을
        // 빈 사이드카로 대신 밀어넣지 않는다 — 그러면 companion/pdf 필드가
        // 빈 문자열로 덮여 써져 §273.2가 요구하는 기록을 잃는다.
        if (sidecar) {
          void updateHighlightColor(
            absSidecarPath,
            sidecar,
            popup.existing.id,
            color,
          )
            .then(setSidecar)
            .catch((err: unknown) =>
              reportWriteFailure("update highlight colour", err),
            );
        }
      } else if (absCompanionPath && pdfRelPath) {
        // §274 I2 Copy reference가 이미 블록을 만들어 뒀으면(popup.blockId)
        // createTextHighlight로 또 만들지 않는다 — 노트에 같은 텍스트의
        // 문단이 두 번 생기고, 먼저 복사해 둔 참조가 사이드카에 없는 id를
        // 가리키게 된다.
        const create = popup.blockId
          ? addHighlightForExistingBlock({
              absSidecarPath,
              blockId: popup.blockId,
              color,
              page: popup.pageNumber,
              pdfRelPath,
              rects: popup.rects,
              sidecar,
            })
          : createTextHighlight({
              absCompanionPath,
              absSidecarPath,
              color,
              page: popup.pageNumber,
              pdfRelPath,
              rects: popup.rects,
              sidecar,
              text: popup.text,
            });
        void create
          .then(({ sidecar: next }) => setSidecar(next))
          .catch((err: unknown) => reportWriteFailure("create highlight", err));
      }
      setPopup(null);
    },
    [
      absCompanionPath,
      absSidecarPath,
      pdfRelPath,
      popup,
      reportWriteFailure,
      sidecar,
    ],
  );

  const onDelete = useCallback(() => {
    if (!popup || popup.kind !== "existing" || !absSidecarPath || !sidecar) {
      setPopup(null);
      return;
    }
    void deleteHighlightById(absSidecarPath, sidecar, popup.existing.id)
      .then(setSidecar)
      .catch((err: unknown) => reportWriteFailure("delete highlight", err));
    setPopup(null);
  }, [absSidecarPath, popup, reportWriteFailure, sidecar]);

  const onCopyText = useCallback(() => {
    if (!popup) return;
    if (popup.kind === "new") {
      void navigator.clipboard
        .writeText(popup.text)
        .catch((err: unknown) => reportClipboardFailure(err));
    } else if (absCompanionPath) {
      const { id } = popup.existing;
      void readHighlightBlockText(absCompanionPath, id)
        .then((text) => {
          if (text) {
            void navigator.clipboard
              .writeText(text)
              .catch((err: unknown) => reportClipboardFailure(err));
          } else {
            logger.warn(
              `[pdf-highlight] companion block missing for ${id}, nothing to copy`,
            );
          }
        })
        .catch((err: unknown) => reportCopyFailure("read highlight text", err));
    }
    // §274 I2 팝업을 닫지 않는다 — Copy text/Copy reference 뒤에도 같은
    // 선택에 색을 입히거나(onPickColor) 삭제(onDelete)를 계속할 수 있게.
  }, [absCompanionPath, popup, reportClipboardFailure, reportCopyFailure]);

  const onCopyRef = useCallback(() => {
    if (!popup || !target) return;
    if (popup.kind === "existing") {
      if (!absCompanionPath) return;
      const { id } = popup.existing;
      void readHighlightBlockText(absCompanionPath, id)
        .then((text) => {
          if (!text) {
            logger.warn(
              `[pdf-highlight] companion block missing for ${id}, can't build a reference`,
            );
            return;
          }
          void navigator.clipboard
            .writeText(
              serializeBlockRef({
                blockId: id,
                display: buildRefDisplay(text),
                target,
              }),
            )
            .catch((err: unknown) => reportClipboardFailure(err));
        })
        .catch((err: unknown) => reportCopyFailure("read highlight text", err));
      return; // §274 I2 팝업 유지
    }

    if (!absCompanionPath) return;

    if (popup.blockId) {
      // §274 I2 이 선택에 대해 이미 만든 블록이 있다 — 재사용한다. 다시
      // appendHighlightBlock을 부르면 노트에 같은 텍스트가 또 생긴다.
      const { blockId, text } = popup;
      void navigator.clipboard
        .writeText(
          serializeBlockRef({
            blockId,
            display: buildRefDisplay(text),
            target,
          }),
        )
        .catch((err: unknown) => reportClipboardFailure(err));
      return;
    }

    // 아직 하이라이트로 만들지 않은 선택 — 참조가 가리킬 블록이 없으면
    // 복사한 ((...)) 가 대상 없이 뜬다. 색을 고르지 않아도 참조는 만들 수
    // 있게, 동반 노트에 블록만 먼저 적어둔다(사이드카/오버레이는 손대지
    // 않는다 — "참조로 저장"과 "PDF에 색칠"은 서로 다른 결정이다).
    const blockId = generateBlockId();
    const { pageNumber, text } = popup;
    void appendHighlightBlock(absCompanionPath, text, blockId)
      .then(() => {
        // §274 I2 방금 만든 id를 팝업 상태에 남겨 둔다 — 이어서 색을
        // 고르면(onPickColor) 두 번째 블록을 만들지 않고 이 id를 재사용
        // 하도록. setState 업데이터로 "지금 팝업이 여전히 그 선택인가"를
        // 확인한다 — await 도중 사용자가 다른 텍스트를 선택했으면(같은
        // 페이지에 같은 문구가 다시 나올 수 있어 text만으로는 부족해
        // pageNumber도 같이 본다) 엉뚱한 팝업에 id를 심지 않는다.
        setPopup((p) =>
          p &&
          p.kind === "new" &&
          p.pageNumber === pageNumber &&
          p.text === text
            ? { ...p, blockId }
            : p,
        );
        void navigator.clipboard
          .writeText(
            serializeBlockRef({
              blockId,
              display: buildRefDisplay(text),
              target,
            }),
          )
          .catch((err: unknown) => reportClipboardFailure(err));
      })
      .catch((err: unknown) =>
        reportCopyFailure("save companion note block", err),
      );
    // §274 I2 팝업 유지 — 실패해도 닫지 않아 재시도할 수 있고, 성공하면
    // 위에서 blockId만 채운다.
  }, [
    absCompanionPath,
    popup,
    reportClipboardFailure,
    reportCopyFailure,
    target,
  ]);

  const popupProps: null | PdfSelectionPopupProps = popup
    ? {
        anchor: popup.anchor,
        existing: popup.kind === "existing" ? popup.existing : null,
        onCopyRef,
        onCopyText,
        onDelete,
        onPickColor,
      }
    : null;

  return {
    flashHighlightId,
    getPageHighlights,
    handlePageMouseDown,
    popupPage: popup?.pageNumber ?? null,
    popupProps,
    registerPageEl,
  };
}

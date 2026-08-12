// §274 하이라이트 오버레이 + 선택 팝업 배선. PdfPreview가 소유한다 —
// use-pdf-find.ts와 같은 자리, 같은 책임 분리(사이드카/DOM 상태는 여기,
// 좌표 변환은 pdf-highlight-geom.ts, IPC 오케스트레이션은
// pdf-highlight-actions.ts/pdf-highlight-store.ts).
//
// 하이라이트는 vault 안에서만 지원한다(사이드카·동반 노트가 vault 상대
// 경로로 식별되므로) — rootPath가 없으면(단일 파일 모드) 조용히 비활성화된다.
import { useCallback, useEffect, useRef, useState } from "react";

import type { PdfRect, ViewportLike } from "./pdf-highlight-geom";
import type {
  HighlightColor,
  Sidecar,
  StoredHighlight,
} from "./pdf-highlight-sidecar";
import type { PdfSelectionPopupProps } from "./PdfSelectionPopup";
import type { PDFPageProxy } from "pdfjs-dist";

import { generateBlockId, serializeBlockRef } from "../../../pipeline/block-id";
import { logger } from "../../../utils/logger";
import { relativeToRoot } from "../../../utils/path-utils";
import {
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

const EMPTY_HIGHLIGHTS: StoredHighlight[] = [];

type PopupState =
  | {
      anchor: { left: number; top: number };
      existing: StoredHighlight;
      kind: "existing";
      pageNumber: number;
    }
  | {
      anchor: { left: number; top: number };
      kind: "new";
      pageNumber: number;
      rects: PdfRect[];
      text: string;
    };

export function usePdfHighlights({
  filePath,
  pages,
  rootPath,
  scale,
}: {
  filePath: string;
  pages: PDFPageProxy[];
  rootPath: null | string;
  scale: number;
}): {
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
  const [sidecar, setSidecar] = useState<null | Sidecar>(null);
  const [popup, setPopup] = useState<null | PopupState>(null);

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
  const target = pdfRelPath
    ? companionPathFor(pdfRelPath).replace(/\.md$/i, "")
    : null;

  // PDF(또는 vault)가 바뀌면 해당 사이드카를 새로 읽고 열린 팝업을 닫는다.
  useEffect(() => {
    setPopup(null);
    if (!absSidecarPath) {
      setSidecar(null);
      return;
    }
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
  useEffect(() => {
    if (!rootPath) return;

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
        kind: "new",
        pageNumber: found.pageNumber,
        rects,
        text,
      });
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelectionChange);
  }, [rootPath, scale]);

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
          ).then(setSidecar);
        }
      } else if (absCompanionPath && pdfRelPath) {
        void createTextHighlight({
          absCompanionPath,
          absSidecarPath,
          color,
          page: popup.pageNumber,
          pdfRelPath,
          rects: popup.rects,
          sidecar,
          text: popup.text,
        }).then(({ sidecar: next }) => setSidecar(next));
      }
      setPopup(null);
    },
    [absCompanionPath, absSidecarPath, pdfRelPath, popup, sidecar],
  );

  const onDelete = useCallback(() => {
    if (!popup || popup.kind !== "existing" || !absSidecarPath || !sidecar) {
      setPopup(null);
      return;
    }
    void deleteHighlightById(absSidecarPath, sidecar, popup.existing.id).then(
      setSidecar,
    );
    setPopup(null);
  }, [absSidecarPath, popup, sidecar]);

  const onCopyText = useCallback(() => {
    if (!popup) return;
    if (popup.kind === "new") {
      void navigator.clipboard.writeText(popup.text);
    } else if (absCompanionPath) {
      const { id } = popup.existing;
      void readHighlightBlockText(absCompanionPath, id).then((text) => {
        if (text) void navigator.clipboard.writeText(text);
        else
          logger.warn(
            `[pdf-highlight] companion block missing for ${id}, nothing to copy`,
          );
      });
    }
    setPopup(null);
  }, [absCompanionPath, popup]);

  const onCopyRef = useCallback(() => {
    if (!popup || !target) return;
    if (popup.kind === "existing") {
      if (!absCompanionPath) return;
      const { id } = popup.existing;
      void readHighlightBlockText(absCompanionPath, id).then((text) => {
        if (!text) {
          logger.warn(
            `[pdf-highlight] companion block missing for ${id}, can't build a reference`,
          );
          return;
        }
        void navigator.clipboard.writeText(
          serializeBlockRef({
            blockId: id,
            display: buildRefDisplay(text),
            target,
          }),
        );
      });
    } else if (absCompanionPath) {
      // 아직 하이라이트로 만들지 않은 선택 — 참조가 가리킬 블록이 없으면
      // 복사한 ((...)) 가 대상 없이 뜬다. 색을 고르지 않아도 참조는 만들 수
      // 있게, 동반 노트에 블록만 먼저 적어둔다(사이드카/오버레이는 손대지
      // 않는다 — "참조로 저장"과 "PDF에 색칠"은 서로 다른 결정이다).
      const blockId = generateBlockId();
      void appendHighlightBlock(absCompanionPath, popup.text, blockId).then(
        () => {
          void navigator.clipboard.writeText(
            serializeBlockRef({
              blockId,
              display: buildRefDisplay(popup.text),
              target,
            }),
          );
        },
      );
    }
    setPopup(null);
  }, [absCompanionPath, popup, target]);

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
    getPageHighlights,
    handlePageMouseDown,
    popupPage: popup?.pageNumber ?? null,
    popupProps,
    registerPageEl,
  };
}

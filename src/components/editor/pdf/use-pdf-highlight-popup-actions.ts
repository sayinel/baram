// §274 하이라이트 선택 팝업의 네 액션(색 고르기/삭제/Copy text/Copy
// reference)이 실제로 무엇을 하는지는 여기 모았다 — use-pdf-highlights.ts가
// 500줄 기준을 넘어서였다(그 파일 헤더 comment의 책임 분리 원칙, 그리고
// use-pdf-selection-popup.ts가 "언제/무엇을 열지"를 이미 같은 이유로 뽑아둔
// 것과 같은 패턴). 상태(popup 자체, sidecar)는 여전히 use-pdf-highlights.ts가
// 갖고, 이 훅은 그 상태를 읽고 setPopup/setSidecar로 되돌려 쓰기만 한다.
//
// PopupState 타입도 여기서 정의해 내보낸다 — 액션들이 이 타입의 분기
// (new vs existing)에 맞춰 동작이 갈리므로, 실제로 그 분기를 소비하는 쪽이
// 타입의 주인이다. use-pdf-highlights.ts는 이 타입을 그대로 import해 자기
// state와 handlePageMouseDown/onNewSelection에 쓴다 — 참조 방향은 한쪽
// (여기 → use-pdf-highlights.ts)뿐이라 순환 import가 아니다.
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

import type { PdfRect } from "./pdf-highlight-geom";
import type {
  HighlightColor,
  HighlightKind,
  Sidecar,
  StoredHighlight,
} from "./pdf-highlight-sidecar";

import { useTranslation } from "../../../i18n/useTranslation";
import { serializeBlockRef } from "../../../pipeline/block-id";
import { useUIStore } from "../../../stores/ui/ui";
import { logger } from "../../../utils/logger";
import {
  createTextHighlight,
  deleteHighlightById,
  updateHighlightColor,
} from "./pdf-highlight-actions";
import { readHighlightBlockText } from "./pdf-highlight-store";
import { buildRefDisplay } from "./pdf-ref-display";

export type PopupState =
  | {
      anchor: { left: number; top: number };
      /** §276.3 이 초안이 색을 고르면 만들 StoredHighlight.kind. 텍스트
       * 선택은 항상 "text"(onNewSelection), 영역 드래그는 항상 "area"
       * (onAreaHighlightDrawn) — 생성 시점에 확정되고 이후 절대 바뀌지 않는다. */
      highlightKind: HighlightKind;
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

export interface UsePdfHighlightPopupActionsResult {
  onCopyRef: () => void;
  onCopyText: () => void;
  onDelete: () => void;
  onPickColor: (color: HighlightColor) => void;
}

export function usePdfHighlightPopupActions({
  absCompanionPath,
  absSidecarPath,
  pdfRelPath,
  popup,
  setPopup,
  setSidecar,
  sidecar,
  target,
}: {
  absCompanionPath: null | string;
  absSidecarPath: null | string;
  pdfRelPath: null | string;
  popup: null | PopupState;
  setPopup: Dispatch<SetStateAction<null | PopupState>>;
  setSidecar: Dispatch<SetStateAction<null | Sidecar>>;
  sidecar: null | Sidecar;
  target: null | string;
}): UsePdfHighlightPopupActionsResult {
  const { t } = useTranslation();

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

  // §274 B.2 Copy reference/Copy text은 실패만 토스트로 알리고 성공은 아무
  // 신호가 없었다 — 사용자는 "복사됐나?" 확신할 방법이 없어 다시 클릭하게
  // 된다는 게 리뷰의 지적이다. 토스트를 고른 이유: 실패 쪽의 정확히 같은 패턴
  // (reportWriteFailure/reportCopyFailure)을 재사용해, PdfSelectionPopup의
  // "순수 표시 컴포넌트" 계약(그 파일 자체 헤더 코멘트)에 새 prop을 얹지
  // 않고 이 훅 안에서만 상태를 닫을 수 있다 — 버튼 라벨을 일시적으로 바꾸는
  // 대안은 팝업에도 상태를 나눠 들여야 한다.
  const reportCopySuccess = useCallback(() => {
    useUIStore.getState().showToast(t("pdfHighlight.copied"), "info");
  }, [t]);

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
        // 초안에 색을 고르는 것이 하이라이트가 만들어지는 유일한 경로다 —
        // 동반 노트 블록과 사이드카 항목이 여기서 함께 생긴다
        // (pdf-highlight-actions.ts의 순서 doc comment 참조).
        void createTextHighlight({
          absCompanionPath,
          absSidecarPath,
          color,
          kind: popup.highlightKind,
          page: popup.pageNumber,
          pdfRelPath,
          rects: popup.rects,
          sidecar,
          text: popup.text,
        })
          .then(({ sidecar: next }) => setSidecar(next))
          .catch((err: unknown) => reportWriteFailure("create highlight", err));
      }
      setPopup(null);
      // §274 UX fix round 2 (defect B) — 색을 고르면 브라우저 네이티브 선택을
      // 지운다. popup.rects/popup.existing은 이 시점 이전에(usePdfSelectionPopup의
      // mouseup, 또는 이전 클릭의 handlePageMouseDown) 이미 확정돼 있으므로
      // 지금 선택을 지워도 위에서 쓴 값에 영향이 없다 — "먼저 지우면 안 된다"는
      // 건 rects를 뽑아내기 전에 지우는 경우 얘기다. 지우면 selectionchange가
      // 한 번 더 뜨지만 rangeCount===0이라 trySelectionPopup이 곧바로
      // 리턴하므로(use-pdf-selection-popup.ts) 팝업이 즉시 재생성되는 회귀는
      // 없다 — use-pdf-highlights.test.ts에서 이 경로를 직접 고정해 둔다.
      window.getSelection()?.removeAllRanges();
    },
    [
      absCompanionPath,
      absSidecarPath,
      pdfRelPath,
      popup,
      reportWriteFailure,
      setPopup,
      setSidecar,
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
  }, [
    absSidecarPath,
    popup,
    reportWriteFailure,
    setPopup,
    setSidecar,
    sidecar,
  ]);

  const onCopyText = useCallback(() => {
    if (!popup) return;
    if (popup.kind === "new") {
      void navigator.clipboard
        .writeText(popup.text)
        .then(reportCopySuccess)
        .catch((err: unknown) => reportClipboardFailure(err));
    } else if (absCompanionPath) {
      const { id } = popup.existing;
      void readHighlightBlockText(absCompanionPath, id)
        .then((text) => {
          if (text) {
            void navigator.clipboard
              .writeText(text)
              .then(reportCopySuccess)
              .catch((err: unknown) => reportClipboardFailure(err));
          } else {
            logger.warn(
              `[pdf-highlight] companion block missing for ${id}, nothing to copy`,
            );
          }
        })
        .catch((err: unknown) => reportCopyFailure("read highlight text", err));
    }
    // §274 round 4 — 다른 세 액션(색 고르기/삭제/Copy reference)과 똑같이
    // 닫는다. 클립보드 쓰기가 비동기라도 먼저 닫는다 — 실패해도 toast로
    // 알리니(reportCopyFailure/reportClipboardFailure) 재시도하려면 다시
    // 선택하면 된다.
    setPopup(null);
  }, [
    absCompanionPath,
    popup,
    reportClipboardFailure,
    reportCopyFailure,
    reportCopySuccess,
    setPopup,
  ]);

  // §274.2 참조 복사는 **이미 만들어진** 하이라이트에서만 제공한다 —
  // PdfSelectionPopup.tsx가 `existing`일 때만 버튼을 그리므로 초안("new")은
  // 여기 닿지 않는다. 초안에 대해 동반 노트 블록을 미리 만들어 두던 경로
  // (§274 I2)는 그 버튼과 함께 사라졌다: 색을 고르지 않으면 사이드카에는
  // 아무것도 없어, 복사된 참조가 가리킬 하이라이트가 없는 채로 남았다.
  const onCopyRef = useCallback(() => {
    if (!popup || popup.kind !== "existing" || !target) return;
    if (absCompanionPath) {
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
            .then(reportCopySuccess)
            .catch((err: unknown) => reportClipboardFailure(err));
        })
        .catch((err: unknown) => reportCopyFailure("read highlight text", err));
    }
    setPopup(null); // §274 round 4 — 나머지 세 액션과 똑같이 닫는다.
  }, [
    absCompanionPath,
    popup,
    reportClipboardFailure,
    reportCopyFailure,
    reportCopySuccess,
    setPopup,
    target,
  ]);

  return { onCopyRef, onCopyText, onDelete, onPickColor };
}

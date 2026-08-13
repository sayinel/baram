// §274 하이라이트 선택 팝업의 네 액션(색 고르기/삭제/Copy text/Copy
// reference)이 실제로 무엇을 하는지는 여기 모았다 — use-pdf-highlights.ts가
// 500줄 기준을 넘어서였다(그 파일 헤더 comment의 책임 분리 원칙, 그리고
// use-pdf-selection-popup.ts가 "언제/무엇을 열지"를 이미 같은 이유로 뽑아둔
// 것과 같은 패턴). 상태(popup 자체, sidecar)는 여전히 use-pdf-highlights.ts가
// 갖고, 이 훅은 그 상태를 읽고 setPopup/setSidecar로 되돌려 쓰기만 한다.
//
// PopupState 타입도 여기서 정의해 내보낸다 — 네 액션 모두 이 타입의 분기
// (new vs existing)에 맞춰 동작이 갈리므로, 실제로 그 분기를 소비하는 쪽이
// 타입의 주인이다. use-pdf-highlights.ts는 이 타입을 그대로 import해 자기
// state와 handlePageMouseDown/onNewSelection에 쓴다 — 참조 방향은 한쪽
// (여기 → use-pdf-highlights.ts)뿐이라 순환 import가 아니다.
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useRef } from "react";

import type { PdfRect } from "./pdf-highlight-geom";
import type { PendingRefBlockCache } from "./pdf-highlight-selection-cache";
import type {
  HighlightColor,
  HighlightKind,
  Sidecar,
  StoredHighlight,
} from "./pdf-highlight-sidecar";

import { useTranslation } from "../../../i18n/useTranslation";
import { generateBlockId, serializeBlockRef } from "../../../pipeline/block-id";
import { useUIStore } from "../../../stores/ui/ui";
import { logger } from "../../../utils/logger";
import {
  addHighlightForExistingBlock,
  createTextHighlight,
  deleteHighlightById,
  updateHighlightColor,
} from "./pdf-highlight-actions";
import {
  appendHighlightBlock,
  readHighlightBlockText,
} from "./pdf-highlight-store";
import { buildRefDisplay } from "./pdf-ref-display";

export type PopupState =
  | {
      anchor: { left: number; top: number };
      /**
       * §274 I2 Copy reference가 이미 이 선택에 대해 동반 노트 블록을
       * 만들었으면 그 id. null이면 아직 아무것도 안 만들었다 — 색을 고르면
       * createTextHighlight(새 id)가, 이미 있으면 addHighlightForExistingBlock
       * (같은 id 재사용)이 갈린다. 이 필드가 없으면 Copy reference 뒤에 색을
       * 고를 때 두 번째 블록이 중복으로 생긴다.
       *
       * §274 round 4 — 이제 모든 팝업 액션이 팝업을 닫으므로(사용자 요청,
       * 일관성), 이 필드 하나만으로는 Copy reference → 팝업 닫힘 → 같은
       * 텍스트 재선택 → 색 고르기 시퀀스를 못 버틴다(재선택은 항상 새
       * popup state를 blockId: null로 만든다). 그 사이를 잇는 건
       * use-pdf-highlights.ts의 onNewSelection이 pendingRefBlockCacheRef에서
       * 찾아 채워 넣는 값이다 — 즉 이 필드는 여전히 "지금 팝업이 재사용할
       * id"를 나타내지만, 그 출처가 이번 세션의 onCopyRef 호출 하나뿐 아니라
       * 캐시 히트일 수도 있다.
       */
      blockId: null | string;
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
  pendingRefBlockCacheRef,
  popup,
  setPopup,
  setSidecar,
  sidecar,
  target,
}: {
  absCompanionPath: null | string;
  absSidecarPath: null | string;
  pdfRelPath: null | string;
  /** use-pdf-highlights.ts가 소유한, onNewSelection과 공유하는 바로 그
   * 캐시 인스턴스 — ref로 넘겨야 두 훅이 같은 Map을 본다. */
  pendingRefBlockCacheRef: { current: PendingRefBlockCache };
  popup: null | PopupState;
  setPopup: Dispatch<SetStateAction<null | PopupState>>;
  setSidecar: Dispatch<SetStateAction<null | Sidecar>>;
  sidecar: null | Sidecar;
  target: null | string;
}): UsePdfHighlightPopupActionsResult {
  const { t } = useTranslation();

  // §274 B.2 onCopyRef의 "아직 블록 없음" 분기를 가드한다 — appendHighlightBlock이
  // 끝나기 전까지 popup.blockId는 null로 남아 있어, 그 창에서 또 클릭하면 같은
  // 선택에 두 번째 문단이 생긴다(§277 non-destructive delete라 영구적). popup
  // state가 아니라 ref로 막는 이유: React state 업데이트는 비동기라 popup.blockId
  // 자체가 바로 이 창을 못 막는다.
  //
  // §274 round 4 — onCopyRef가 이제 즉시 setPopup(null)을 부르지만, 이 가드는
  // 여전히 필요하다: 팝업이 DOM에서 실제로 사라지는 건 React가 그 커밋을
  // 반영한 뒤다(비동기 렌더). 그 사이의 아주 짧은 창에 같은 버튼을 두 번
  // 누르면(진짜 더블클릭) onCopyRef가 두 번 불릴 수 있어, 이 전역 가드가 여전히
  // 막아야 한다. 팝업이 닫힌 뒤 다시 열린 별개의 인스턴스에 대해서는 이 가드가
  // 막지 않는다 — 그건 pendingRefBlockCacheRef의 몫이다.
  const copyRefAppendInFlightRef = useRef(false);

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
  // 신호가 없었다 — 팝업이 의도적으로 안 닫히니(§274 I2, round 4 전) 사용자는
  // "복사됐나?" 확신할 방법이 없어 다시 클릭하게 되고, 그게
  // copyRefAppendInFlightRef가 막는 이중 클릭의 실제 유발 원인이라는 게
  // 리뷰의 지적이다. 토스트를 고른 이유: 실패 쪽의 정확히 같은 패턴
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
        // §274 I2 Copy reference가 이미 블록을 만들어 뒀으면(popup.blockId)
        // createTextHighlight로 또 만들지 않는다 — 노트에 같은 텍스트의
        // 문단이 두 번 생기고, 먼저 복사해 둔 참조가 사이드카에 없는 id를
        // 가리키게 된다.
        const create = popup.blockId
          ? addHighlightForExistingBlock({
              absSidecarPath,
              blockId: popup.blockId,
              color,
              kind: popup.highlightKind,
              page: popup.pageNumber,
              pdfRelPath,
              rects: popup.rects,
              sidecar,
            })
          : createTextHighlight({
              absCompanionPath,
              absSidecarPath,
              color,
              kind: popup.highlightKind,
              page: popup.pageNumber,
              pdfRelPath,
              rects: popup.rects,
              sidecar,
              text: popup.text,
            });
        // §274 round 4 — 이 선택이 pendingRefBlockCacheRef에 남아 있었다면
        // (또는 없었더라도, delete는 없는 키에 대해 no-op이다) 지금 지운다:
        // 방금 실제로 사이드카에 하이라이트가 생겼으니, 같은 선택을 다시
        // 색칠하면 addHighlightForExistingBlock이 같은 id를 가진 두 번째
        // 사이드카 항목을 또 만들게 된다 — 문단 중복은 아니지만 id 중복은
        // 그 자체로 update/delete가 둘을 하나로 취급하는 새 버그다.
        const { pageNumber, rects, text } = popup;
        void create
          .then(({ sidecar: next }) => {
            pendingRefBlockCacheRef.current.delete({ pageNumber, rects, text });
            setSidecar(next);
          })
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
      pendingRefBlockCacheRef,
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
    // 선택하면 된다. 이 선택에 대해 아직 만든 블록이 있었으면(캐시) 그대로
    // 남아 있다 — 이 액션은 그 캐시를 건드리지 않는다.
    setPopup(null);
  }, [
    absCompanionPath,
    popup,
    reportClipboardFailure,
    reportCopyFailure,
    reportCopySuccess,
    setPopup,
  ]);

  const onCopyRef = useCallback(() => {
    if (!popup || !target) return;
    if (popup.kind === "existing") {
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
          .catch((err: unknown) =>
            reportCopyFailure("read highlight text", err),
          );
      }
      setPopup(null); // §274 round 4 — 나머지 세 액션과 똑같이 닫는다.
      return;
    }

    if (!absCompanionPath) {
      setPopup(null);
      return;
    }

    if (popup.blockId) {
      // §274 I2 이 선택에 대해 이미 만든 블록이 있다(방금 이 팝업에서
      // 만들었거나, pendingRefBlockCacheRef에서 찾은 것) — 재사용한다. 다시
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
        .then(reportCopySuccess)
        .catch((err: unknown) => reportClipboardFailure(err));
      setPopup(null);
      return;
    }

    // §274 B.2 아직 append가 안 끝났는데(popup.blockId는 그 사이 계속 null이다)
    // 또 클릭하면 아래 appendHighlightBlock이 같은 선택에 두 번째 문단을
    // 만든다 — 가드는 copyRefAppendInFlightRef 선언부 코멘트 참조. 팝업은
    // 어차피 닫으니(아래) 이 분기가 막는 건 "닫히기 전 짧은 창의 더블클릭"
    // 뿐이다.
    if (copyRefAppendInFlightRef.current) {
      setPopup(null);
      return;
    }
    copyRefAppendInFlightRef.current = true;

    // 아직 하이라이트로 만들지 않은 선택 — 참조가 가리킬 블록이 없으면
    // 복사한 ((...)) 가 대상 없이 뜬다. 색을 고르지 않아도 참조는 만들 수
    // 있게, 동반 노트에 블록만 먼저 적어둔다(사이드카/오버레이는 손대지
    // 않는다 — "참조로 저장"과 "PDF에 색칠"은 서로 다른 결정이다).
    const blockId = generateBlockId();
    const { pageNumber, rects, text } = popup;
    void appendHighlightBlock(absCompanionPath, text, blockId)
      .then(() => {
        // §274 round 4 — 방금 만든 id를 이 선택 키로 캐시에 남긴다. 팝업은
        // 이미 닫혔으니(아래 setPopup(null)) 이걸 읽는 건 이 팝업 자신이
        // 아니라 나중에 같은 텍스트를 재선택했을 때의 onNewSelection이다.
        // setState 업데이터로 "지금 열려 있는 팝업이 여전히 그 선택인가"도
        // 같이 확인한다 — await 도중 사용자가 이 텍스트를 다시 선택해 새
        // 팝업이 이미 떠 있었다면(캐시가 아직 안 채워진 사이라 blockId:
        // null로 열렸을 것이다) 그 팝업에도 바로 채워 넣어, 또 재선택하지
        // 않고도 곧장 재사용 경로를 타게 한다.
        pendingRefBlockCacheRef.current.set(
          { pageNumber, rects, text },
          blockId,
        );
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
          .then(reportCopySuccess)
          .catch((err: unknown) => reportClipboardFailure(err));
      })
      .catch((err: unknown) =>
        reportCopyFailure("save companion note block", err),
      )
      .finally(() => {
        copyRefAppendInFlightRef.current = false;
      });
    setPopup(null); // §274 round 4 — 나머지 세 액션과 똑같이 즉시 닫는다.
  }, [
    absCompanionPath,
    pendingRefBlockCacheRef,
    popup,
    reportClipboardFailure,
    reportCopyFailure,
    reportCopySuccess,
    setPopup,
    target,
  ]);

  return { onCopyRef, onCopyText, onDelete, onPickColor };
}

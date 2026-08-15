// §276.4/§276.5 하이라이트 참조를 그 하이라이트 자체로 그리는 훅.
//
// area — 디스크에는 여전히 좌표만 있다(§276.3의 결정을 뒤집지 않는다). 이미지
// 파일을 만들지 않고 매 표시마다 PDF에서 그 영역만 캔버스로 잘라낸다.
// text — 원문 전체를 동반 노트에서 읽어 온다. 마크다운의 `display` 슬롯은
// 여전히 §275.3이 구워 넣은 80자 라벨이지만, 그것은 이제 폴백일 뿐이다
// (로딩 중 · 읽기 실패 · vault 밖). 원문은 동반 노트에 온전히 있으므로 이미
// 붙여넣은 참조도 소급해서 전문이 보이고, buildRefDisplay가 지우는
// `( ) [ ] |`도 되살아난다.
//
// 어느 쪽이든 마크다운 표현은 `((target#^blockId|display))` 그대로다 —
// 표시 시점의 결정이고 디스크는 한 글자도 바뀌지 않는다.
import { useEffect, useState } from "react";

import { useFileStore } from "../../../stores/file/file";
import { logger } from "../../../utils/logger";
import { computeAreaCropLayout } from "./pdf-area-crop";
import {
  areaPreviewCacheKey,
  readAreaPreview,
  writeAreaPreview,
} from "./pdf-area-preview-cache";
import { readCompanionTextCoalesced } from "./pdf-companion-text-cache";
import { withPdfDocument } from "./pdf-doc-cache";
import { pdfRectToPageLocal } from "./pdf-highlight-geom";
import { resolveHighlightRef } from "./pdf-highlight-ref-resolve";
import { pdfRelPathForHighlightTarget } from "./pdf-highlight-sidecar";

export interface HighlightRefPreview {
  /** CSS px. area가 아니거나 status !== "ready"면 0. */
  height: number;
  /** "none" = 그릴 하이라이트가 없다(평범한 블록 참조이거나 해석 실패). */
  kind: HighlightRefPreviewKind;
  /** area의 dataURL. 그 외에는 null. */
  src: null | string;
  status: HighlightRefPreviewStatus;
  /** text의 원문 전체. 그 외에는 null. */
  text: null | string;
  /** CSS px. area가 아니거나 status !== "ready"면 0. */
  width: number;
}

export type HighlightRefPreviewKind = "area" | "none" | "text";

/** "idle" = 하이라이트 참조가 아니다(평범한 블록 참조 — 가장 흔한 경우). */
export type HighlightRefPreviewStatus =
  "idle" | "loading" | "ready" | "unavailable";

/**
 * `(target, blockId)`가 하이라이트를 가리키면 그것을 그리는 데 필요한 것을
 * 돌려준다 — area면 잘라낸 PNG dataURL, text면 동반 노트의 원문 전체.
 * 아니거나 실패하면 status가 "ready"가 아니고, 호출부는 기존 글자 칩을 그대로
 * 그린다 — **이 훅은 절대 던지지 않는다.**
 *
 * 던지지 않는 것이 왜 중요한가: main.tsx의 전역 unhandledrejection 핸들러가
 * preventDefault()로 rejection을 삼킨다. 떠도는 Promise를 남기면 실패가
 * 로그도 없이 사라지고 칩은 영원히 "loading"에 머문다.
 */
export function usePdfHighlightRefPreview(
  target: string,
  blockId: string,
): HighlightRefPreview {
  const [preview, setPreview] = useState<HighlightRefPreview>(IDLE);
  // ‼️ §276.5.1 rootPath를 **구독**한다. resolveHighlightRef는 이 값을
  // getState()로 읽고 없으면 즉시 null을 돌려주는데(단일 파일 모드), 콜드
  // 스타트에서는 세션 복원이 노트를 먼저 그리고 vault 루트는 그 뒤 IPC로
  // 도착한다. 구독하지 않으면 그 창에서 마운트된 모든 하이라이트 참조가
  // 영구히 "unavailable"로 굳어 잘린 display 라벨만 남는다 — 재시도할 계기가
  // 없기 때문이다(deps가 [target, blockId]뿐이었다). 실사용자가 정확히 그
  // 증상을 보고했다: 만든 직후에는 원문 전체가 보이는데 앱을 껐다 켜면
  // 앞부분만 보인다.
  //
  // 값 자체는 아래에서 쓰지 않는다(resolveHighlightRef가 스스로 읽는다) —
  // 여기서는 **effect를 다시 돌릴 계기**로만 쓴다.
  const rootPath = useFileStore((s) => s.rootPath);

  useEffect(() => {
    // 평범한 블록 참조는 여기서 끝낸다 — 사이드카 I/O도, pdfjs 동적 import도
    // 하지 않는다. 문서의 블록 참조 대부분이 이 경로다.
    //
    // ‼️ 이 가드가 막는 것은 I/O가 아니다(resolveHighlightRef도 같은
    // 검사를 먼저 해서 아무것도 읽지 않고 null을 돌려준다). 막는 것은
    // **상태 전이**다: 이게 없으면 문서 안의 모든 블록 참조가 마운트마다
    // LOADING → UNAVAILABLE 두 번의 리렌더를 낸다. IDLE은 useState의 초기값과
    // 같은 모듈 상수라 setPreview(IDLE)은 React의 즉시 bailout에 걸려
    // 리렌더를 만들지 않는다.
    if (!pdfRelPathForHighlightTarget(target)) {
      setPreview(IDLE);
      return;
    }

    let cancelled = false;
    let renderTask: null | { cancel: () => void } = null;
    setPreview(LOADING);

    void (async () => {
      const resolved = await resolveHighlightRef(target, blockId);
      if (cancelled || !resolved) {
        if (!cancelled) setPreview(UNAVAILABLE);
        return;
      }

      // §276.5 텍스트 분기는 pdfjs를 아예 건드리지 않는다 — 동적 import도,
      // 문서 캐시도 타지 않는다. 필요한 것은 동반 노트 한 줄뿐이다.
      if (resolved.kind === "text") {
        const text = await readCompanionTextCoalesced(
          resolved.absCompanionPath,
          blockId,
        );
        if (cancelled) return;
        // 공백만 남은 문단(문단이 지워졌거나 ` ^id`만 남은 줄)을 "ready"로
        // 보내면 칩이 빈 채로 그려져 클릭할 것조차 없어진다. display 라벨로
        // 떨어지는 편이 낫다.
        setPreview(
          text && text.trim().length > 0
            ? {
                height: 0,
                kind: "text",
                src: null,
                status: "ready",
                text,
                width: 0,
              }
            : UNAVAILABLE,
        );
        return;
      }

      const rendered = await withPdfDocument(
        resolved.absPdfPath,
        async (doc) => {
          const page = await doc.getPage(resolved.page);
          if (cancelled) return null;

          const layout = computeAreaCropLayout({
            dpr: window.devicePixelRatio,
            maxCssWidth: MAX_PREVIEW_CSS_WIDTH,
            // scale 1 뷰포트를 기준으로 잡는 이유: 회전·축 뒤집힘은
            // pdfRectToPageLocal이 처리하고, 스케일은 아래 layout이 정한다.
            pageLocalAtScale1: pdfRectToPageLocal(
              resolved.rect,
              page.getViewport({ scale: 1 }),
            ),
          });
          if (!layout) {
            // 그릴 수 없는 기하 — 조용히 칩으로 떨어지면 사이드카가 상했다는
            // 사실이 어디에도 남지 않는다.
            logger.error(
              `[pdf-highlight-ref] unrenderable area geometry for ^${blockId} (page ${String(resolved.page)}) in ${resolved.absPdfPath}`,
            );
            return null;
          }
          // 레이아웃 계산과 렌더 사이의 언마운트를 여기서 잡는다. 이 지점의
          // renderTask는 아직 null이라 cleanup의 cancel()이 닿지 못한다 —
          // 확인하지 않으면 언마운트된 뒤에도 렌더가 끝까지 돌아간다.
          if (cancelled) return null;

          // 캐시 조회를 레이아웃 **뒤에** 하는 이유: 키에 들어가는 canvasWidth는
          // 회전이 반영된 rect 크기에서 나오므로 뷰포트 없이는 알 수 없다.
          // 그래서 이 캐시는 PDF 로드를 아껴주지 못하고, 아끼는 것은 그 뒤의
          // render + toDataURL이다(비용 논의는 pdf-area-preview-cache.ts 헤더).
          const key = areaPreviewCacheKey(
            resolved.absPdfPath,
            blockId,
            layout.canvasWidth,
          );
          const hit = readAreaPreview(key);
          if (hit) {
            return {
              height: layout.cssHeight,
              src: hit,
              width: layout.cssWidth,
            };
          }

          const canvas = document.createElement("canvas");
          canvas.width = layout.canvasWidth;
          canvas.height = layout.canvasHeight;
          const task = page.render({
            canvas,
            viewport: page.getViewport({
              offsetX: layout.offsetX,
              offsetY: layout.offsetY,
              scale: layout.renderScale,
            }),
          });
          renderTask = task;
          await task.promise;
          if (cancelled) return null;

          const src = canvas.toDataURL("image/png");
          writeAreaPreview(key, src);
          return { height: layout.cssHeight, src, width: layout.cssWidth };
        },
      );

      if (cancelled) return;
      setPreview(
        rendered
          ? { ...rendered, kind: "area" as const, status: "ready", text: null }
          : UNAVAILABLE,
      );
    })().catch((err: unknown) => {
      // 렌더 취소는 정상 경로(언마운트/attrs 변경) — cancelled면 조용히 끝낸다.
      if (cancelled) return;
      logger.error("[pdf-highlight-ref] failed to render preview:", err);
      setPreview(UNAVAILABLE);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [target, blockId, rootPath]);

  return preview;
}

/** 프리뷰 표시 폭 상한(CSS px). 넘는 영역은 비율을 유지하며 축소된다. */
const MAX_PREVIEW_CSS_WIDTH = 640;

const IDLE: HighlightRefPreview = {
  height: 0,
  kind: "none",
  src: null,
  status: "idle",
  text: null,
  width: 0,
};

const LOADING: HighlightRefPreview = {
  height: 0,
  kind: "none",
  src: null,
  status: "loading",
  text: null,
  width: 0,
};

const UNAVAILABLE: HighlightRefPreview = {
  height: 0,
  kind: "none",
  src: null,
  status: "unavailable",
  text: null,
  width: 0,
};

// §276.4 영역 하이라이트 참조를 잘라낸 PDF 이미지로 그리는 훅.
//
// 디스크에는 여전히 좌표만 있다(§276.3의 결정을 뒤집지 않는다) — 이미지
// 파일을 만들지 않고 매 표시마다 PDF에서 그 영역만 캔버스로 잘라낸다.
// 마크다운 표현은 `((target#^blockId|display))` 그대로다.
import { useEffect, useState } from "react";

import { logger } from "../../../utils/logger";
import { computeAreaCropLayout } from "./pdf-area-crop";
import { resolveAreaHighlightRef } from "./pdf-area-ref-resolve";
import { withPdfDocument } from "./pdf-doc-cache";
import { pdfRectToPageLocal } from "./pdf-highlight-geom";
import { pdfRelPathForHighlightTarget } from "./pdf-highlight-sidecar";

export interface AreaRefPreview {
  /** CSS px. status !== "ready"면 0. */
  height: number;
  src: null | string;
  status: AreaRefPreviewStatus;
  /** CSS px. status !== "ready"면 0. */
  width: number;
}

/** "idle" = 영역 참조가 아니다(평범한 블록 참조 — 가장 흔한 경우). */
export type AreaRefPreviewStatus = "idle" | "loading" | "ready" | "unavailable";

/**
 * `(target, blockId)`가 영역 하이라이트를 가리키면 잘라낸 PNG dataURL을
 * 돌려준다. 아니거나 실패하면 status가 "ready"가 아니고, 호출부는 기존 글자
 * 칩을 그대로 그린다 — **이 훅은 절대 던지지 않는다.**
 *
 * 던지지 않는 것이 왜 중요한가: main.tsx의 전역 unhandledrejection 핸들러가
 * preventDefault()로 rejection을 삼킨다. 떠도는 Promise를 남기면 실패가
 * 로그도 없이 사라지고 칩은 영원히 "loading"에 머문다.
 */
export function usePdfAreaRefPreview(
  target: string,
  blockId: string,
): AreaRefPreview {
  const [preview, setPreview] = useState<AreaRefPreview>(IDLE);

  useEffect(() => {
    // 평범한 블록 참조는 여기서 끝낸다 — 사이드카 I/O도, pdfjs 동적 import도
    // 하지 않는다. 문서의 블록 참조 대부분이 이 경로다.
    if (!pdfRelPathForHighlightTarget(target)) {
      setPreview(IDLE);
      return;
    }

    let cancelled = false;
    let renderTask: null | { cancel: () => void } = null;
    setPreview(LOADING);

    void (async () => {
      const resolved = await resolveAreaHighlightRef(target, blockId);
      if (cancelled || !resolved) {
        if (!cancelled) setPreview(UNAVAILABLE);
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
          if (!layout) return null;

          // 캐시 조회를 레이아웃 **뒤에** 하는 이유: 키에 들어가는 canvasWidth는
          // 회전을 반영한 rect 크기에서 나오므로 뷰포트 없이는 알 수 없다.
          // 여기까지의 비용은 pdfjs가 내부적으로 캐시하는 getPage/getViewport뿐이고,
          // 진짜 비싼 render + toDataURL은 히트 시 건너뛴다.
          const key = `${resolved.absPdfPath}|${blockId}|${layout.canvasWidth}`;
          const hit = readPreviewCache(key);
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
          writePreviewCache(key, src);
          return { height: layout.cssHeight, src, width: layout.cssWidth };
        },
      );

      if (cancelled) return;
      setPreview(
        rendered ? { ...rendered, status: "ready" as const } : UNAVAILABLE,
      );
    })().catch((err: unknown) => {
      // 렌더 취소는 정상 경로(언마운트/attrs 변경) — cancelled면 조용히 끝낸다.
      if (cancelled) return;
      logger.error("[pdf-area-ref] failed to render area preview:", err);
      setPreview(UNAVAILABLE);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [target, blockId]);

  return preview;
}

/** 프리뷰 표시 폭 상한(CSS px). 넘는 영역은 비율을 유지하며 축소된다. */
const MAX_PREVIEW_CSS_WIDTH = 640;

/** dataURL 캐시 상한. PNG dataURL은 수백 KB가 될 수 있어 넉넉히 잡지 않는다. */
const PREVIEW_CACHE_LIMIT = 32;

const IDLE: AreaRefPreview = {
  height: 0,
  src: null,
  status: "idle",
  width: 0,
};

const LOADING: AreaRefPreview = {
  height: 0,
  src: null,
  status: "loading",
  width: 0,
};

const UNAVAILABLE: AreaRefPreview = {
  height: 0,
  src: null,
  status: "unavailable",
  width: 0,
};

// 모듈 레벨 — 같은 참조를 다시 마운트해도(스크롤 아웃/인, 탭 전환) 다시
// 그리지 않는다. Map의 삽입 순서를 LRU로 쓴다.
const previewCache = new Map<string, string>();

function readPreviewCache(key: string): string | undefined {
  const src = previewCache.get(key);
  if (src === undefined) return undefined;
  // 재삽입으로 최신으로 올린다 — 안 하면 자주 보는 프리뷰가 먼저 버려진다.
  previewCache.delete(key);
  previewCache.set(key, src);
  return src;
}

function writePreviewCache(key: string, src: string): void {
  previewCache.delete(key);
  previewCache.set(key, src);
  while (previewCache.size > PREVIEW_CACHE_LIMIT) {
    const oldest = previewCache.keys().next().value;
    if (oldest === undefined) break;
    previewCache.delete(oldest);
  }
}

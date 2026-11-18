// §3.3 본문 이미지의 "원본 보기" 전체화면 — SVG(§5.1)·Mermaid(§5.5)의 Fullscreen view와
// 같은 구조(오버레이 + 헤더의 Close + 본문).
//
// 왜 필요한가: 본문은 이제 2048px 프리뷰를 그린다(use-image-preview.ts). 화면에서 구별되지
// 않는 크기지만 **원본을 볼 방법이 사라지면 안 된다** — 사진의 세부를 확인하는 것은 저널을
// 쓰는 사람이 실제로 하는 일이다. 그래서 원본 디코드는 없애는 것이 아니라 **사용자가
// 요청할 때로 옮긴다.**
//
// ‼️ 프리뷰를 먼저 깔고 원본을 그 위에 올린다. 199.8 MPix 원본은 디코드에 초 단위가 걸리므로
// 빈 모달을 몇 초 보여주는 것보다 낫고, 무엇을 보고 있는지 헤더가 말해 준다("원본
// 불러오는 중…"). 모달을 닫으면 <img>가 언마운트되어 원본의 디코드 결과를 쥔 쪽이 사라진다 —
// 열어야 치르는 비용이다. 언제 풀리는지는 WebKit 이 정한다: 2026-11-18 측정에서 닫고 5초 뒤에도
// WebContent 메모리가 닫기 직전 크기에 머문 경우가 있었다.
//
// §396 이 모달은 줌의 주인이다(useViewerZoom) — 배율은 이미지의 맞춤 크기에 곱해지고, 프리뷰가
// 원본으로 바뀌면 `contentKey` 로 다시 잰다(원본은 로드 전 display: none 이라 폭이 없어 건너뛴다).
//
// §396 알려진 한계: 큰 원본은 줌이 어떤 배율을 넘을 때 멈춘다 — 16320×12240 사진에서 단계 줌 한
// 번에 최대 1.1초, 연속 줌에서 최대 2.2초(2026-11-17 · 18 앱 측정. 두 최대값은 다른 프로세스의 부하가
// 높던 11-17 시험 사진 측정의 것이다). 시험 사진에서 그 배율은 WebKit trunk 소스로 계산한 해상도
// 단계(subsampling)의 경계와 맞는다. 원본 해상도를 decode() 로 미리 디코드해 두어도 줄지 않았다
// (11-18 측정). 남은 길로 본 것은 원본을 조각으로 나눠 보이는 조각만 그리는 방식이다. 측정 기록은
// dev/impl-notes/0103.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useFontSurface } from "../../hooks/use-font-surface";
import { useViewerZoom } from "../../hooks/use-viewer-zoom";
import { useTranslation } from "../../i18n/useTranslation";
import { ViewerZoomControls } from "./ViewerZoomControls";

export function ImageOriginalView({
  alt,
  onClose,
  originalUrl,
  previewUrl,
}: {
  alt: string;
  onClose: () => void;
  /** 원본의 asset URL. */
  originalUrl: string;
  /** 본문이 이미 그리고 있는 프리뷰 — 원본이 디코드될 때까지 깔아 둔다. null이면 빈 배경. */
  previewUrl: null | string;
}) {
  const [originalLoaded, setOriginalLoaded] = useState(false);
  // §349 이 오버레이는 document.body 로 포털된다 — 문서 표면의 변수를
  // 상속받지 못하므로 루트에 직접 덮는다.
  const fontSurface = useFontSurface("both");
  const { t } = useTranslation();
  const zoom = useViewerZoom({
    contentKey: originalLoaded,
    contentSelector: ".image-fullscreen-img",
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="image-fullscreen-overlay"
      // NodeViewWrapper의 onClick으로 버블링되면 블록이 선택돼 편집 모드로 들어간다
      // (svg-block-view.tsx의 같은 주석 참조 — 포털은 React 트리를 타고 올라간다).
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          e.preventDefault();
          onClose();
        }
      }}
      ref={fontSurface}
    >
      <div className="image-view-fullscreen-modal">
        <div className="image-fullscreen-header">
          <span className="image-fullscreen-label">
            {originalLoaded
              ? t("imageOriginal.title")
              : t("imageOriginal.loading")}
          </span>
          <ViewerZoomControls className="image-fullscreen-zoom" zoom={zoom} />
          <button
            className="image-fullscreen-close"
            onClick={onClose}
            onMouseDown={(e) => e.preventDefault()}
          >
            {t("common.close")}
          </button>
        </div>
        <div className="image-view-fullscreen-body" ref={zoom.scrollRef}>
          {/*
            둘을 겹쳐 두고 원본이 준비되면 프리뷰를 감춘다. src를 교체하지 않는 이유:
            교체하면 원본을 디코드하는 동안 <img>가 비어 화면이 한 번 깜박인다 — 이 작업
            전체가 없애려던 그 깜박임이다.
          */}
          {previewUrl && !originalLoaded && (
            <img
              alt={alt}
              className="image-fullscreen-img image-fullscreen-img-preview"
              src={previewUrl}
            />
          )}
          <img
            alt={alt}
            className="image-fullscreen-img"
            onLoad={() => setOriginalLoaded(true)}
            src={originalUrl}
            style={originalLoaded ? undefined : { display: "none" }}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

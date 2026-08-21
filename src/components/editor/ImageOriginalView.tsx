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
// 불러오는 중…"). 모달을 닫으면 <img>가 언마운트되어 그 비트맵(RGBA ~800MB)이 곧 풀린다 —
// 열어 둔 동안만 치르는 비용이다.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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
    >
      <div className="image-view-fullscreen-modal">
        <div className="image-fullscreen-header">
          <span className="image-fullscreen-label">
            {originalLoaded ? "Original" : "Loading original…"}
          </span>
          <button
            className="image-fullscreen-close"
            onClick={onClose}
            onMouseDown={(e) => e.preventDefault()}
          >
            Close
          </button>
        </div>
        <div className="image-view-fullscreen-body">
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

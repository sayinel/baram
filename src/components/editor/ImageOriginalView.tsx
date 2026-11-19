// §3.3 본문 이미지의 "원본 보기" 전체화면 — SVG(§5.1)·Mermaid(§5.5)의 Fullscreen view와
// 같은 구조(오버레이 + 헤더의 Close + 본문).
//
// 왜 필요한가: 본문은 이제 2048px 프리뷰를 그린다(use-image-preview.ts). 화면에서 구별되지
// 않는 크기지만 **원본을 볼 방법이 사라지면 안 된다** — 사진의 세부를 확인하는 것은 저널을
// 쓰는 사람이 실제로 하는 일이다. 그래서 원본 디코드는 없애는 것이 아니라 **사용자가
// 요청할 때로 옮긴다.**
//
// ‼️ 프리뷰를 먼저 깔고 원본을 그 위에 올린다(타일을 받지 않는 사진 — 아래 §397). 199.8 MPix 원본은
// 디코드에 초 단위가 걸리므로 빈 모달을 몇 초 보여주는 것보다 낫고, 무엇을 보고 있는지 헤더가 말해 준다("원본
// 불러오는 중…"). 모달을 닫으면 <img>가 언마운트되어 원본의 디코드 결과를 쥔 쪽이 사라진다 —
// 열어야 치르는 비용이다. 언제 풀리는지는 WebKit 이 정한다: 2026-11-18 측정에서 닫고 5초 뒤에도
// WebContent 메모리가 닫기 직전 크기에 머문 경우가 있었다.
//
// §396 이 모달은 줌의 주인이다(useViewerZoom) — 배율은 이미지의 맞춤 크기에 곱해지고, 내용이 바뀌면
// `contentKey` 로 다시 잰다: 프리뷰가 원본으로 바뀔 때(원본은 로드 전 display: none 이라 폭이 없어
// 건너뛴다), 타일 경로에서 원본 크기가 올 때와 타일이 준비될 때.
//
// §397 타일(spec 0078): 원본의 경로(`originalPath`)가 있으면 Rust `image_tiles` 에 묻는다(useImageTiles). 답이
// 피라미드면 원본 `<img>` 를 붙이지 않는다 — 원본 크기로 깐 바닥 요소 하나 위에 ImageTileLayer 가 지금 배율에
// 맞는 레벨의 보이는 512px 타일만 겹친다. 피라미드는 처음 열 때 디스크에 만들고(그동안은 흐린 프리뷰만 — D6.
// 프리뷰가 원본 자신이면 크기가 온 뒤로는 그것도 없다 — `preview` 주석), 캐시에 남아 있으면 다시 만들지 않는다.
// 오늘의 경로(프리뷰 → 숨긴 원본 `<img>` → 교체, D7)는 `useImageTiles` 가 `original` 을 내는 세 경우의 것이다:
// 경로가 null(본문 이미지의 src 가 비었거나 원격 `http(s)` URL · data URI 이거나, 열린 노트가 없을 때의 상대
// 경로 — `originalImagePath`. 라이트박스는 늘 사진의 경로를 넘긴다), 답이
// `original`(Rust `probe` 의 판정 둘 — GIF 전부 · APNG · 애니메이션 WebP, 가로 · 세로가 모두 2048 이하), 그리고
// 거절(인가 밖 · `MAX_SOURCE_PIXELS` 초과 · `image` 크레이트가 열지 못하는 형식 · 디코드나 IO 실패 등). 그 경로의
// 큰 사진에는 §396 의 한계 — 줌이 어떤 배율을 넘을 때 멈춘다(dev/impl-notes/0103) — 가 그대로 남는다.
// 타일로 옮긴 근거는 spec 0078 §5.2 의 앱 A/B(2026-11-19, debug 앱 · 시스템 WKWebView, 16320×12240 시험 사진,
// 세션 4개)다: 단계 줌의 최악 프레임이 오늘의 원본 보기 511–536 ms 에서 타일 스파이크 44–49 ms, 연속 줌이
// 934–1171 ms 에서 43–49 ms 였다. 스파이크는 미리 잘라 둔 타일을 쓴 버리는 코드라 그 수치에 생성 시간은 없다.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { TileSetTiles } from "../../ipc/image-tiles";

import { useFontSurface } from "../../hooks/use-font-surface";
import { useImageTiles } from "../../hooks/use-image-tiles";
import { useViewerZoom } from "../../hooks/use-viewer-zoom";
import { useTranslation } from "../../i18n/useTranslation";
import { tileUrl } from "../../ipc/image-tiles";
import { ImageTileLayer } from "./ImageTileLayer";
import { ViewerZoomControls } from "./ViewerZoomControls";

export function ImageOriginalView({
  alt,
  onClose,
  originalPath,
  originalUrl,
  previewUrl,
}: {
  alt: string;
  onClose: () => void;
  /** §397 원본의 절대 경로 — 타일 피라미드를 묻는다. null이면 묻지 않고 원본 `<img>` 로 간다. */
  originalPath: null | string;
  /** 원본의 asset URL. 타일을 받지 않는 사진에서만 붙는다. */
  originalUrl: string;
  /** 본문이 이미 그리고 있는 프리뷰 — 원본이 디코드될 때까지 깔아 둔다. null이면 빈 배경. */
  previewUrl: null | string;
}) {
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const tiles = useImageTiles(originalPath);
  const { set, size } = tiles;
  // 준비는 그것을 알린 피라미드와 함께 둔다 — 경로가 바뀌어 다른 피라미드가 오면 다시 기다린다.
  const [readySet, setReadySet] = useState<null | TileSetTiles>(null);
  const tilesReady = set !== null && readySet === set;
  // 로드에 실패한 프리뷰의 URL. 피라미드가 있으면 그 대신 가장 작은 타일이 바닥 요소가 된다(바닥 요소 주석).
  const [brokenPreview, setBrokenPreview] = useState<null | string>(null);
  const baseRef = useRef<HTMLImageElement | null>(null);
  const bodyRef = useRef<HTMLElement | null>(null);
  // §349 이 오버레이는 document.body 로 포털된다 — 문서 표면의 변수를
  // 상속받지 못하므로 루트에 직접 덮는다.
  const fontSurface = useFontSurface("both");
  const { t } = useTranslation();
  const zoom = useViewerZoom({
    contentKey: [
      originalPath,
      originalLoaded,
      size?.width,
      size?.height,
      tilesReady,
    ].join("|"),
    contentSelector: ".image-fullscreen-img",
  });
  // 본문은 줌의 스크롤 영역(콜백 ref)이면서 타일 레이어가 읽는 RefObject 다 — 한 콜백이 둘 다 맡는다.
  const { scrollRef } = zoom;
  const setBody = useCallback(
    (el: HTMLElement | null) => {
      bodyRef.current = el;
      scrollRef(el);
    },
    [scrollRef],
  );
  // 바닥 요소에 쓸 프리뷰. 썸네일을 만들지 못하면 opener 의 프리뷰는 원본 자신이다(`resolveThumbUrl` 의 폴백). 두
  // opener 는 그 폴백과 `originalUrl` 을 같은 규칙으로 짓는다 — 본문은 같은 src 를 활성 노트의 폴더에 붙여
  // (`absolutePathOf` · `resolveMediaSrc`), 라이트박스는 둘 다 `convertFileSrc(photo.absolutePath)`. 크기를 알면
  // (2048 을 넘는 사진에만 온다 — `useImageTiles`) 그것을 프리뷰로 치지 않는다: 바닥 요소가 원본이면 피라미드를
  // 짓는 동안 원본을 디코드하고(spec 0078 D6), 다 된 뒤에도 줌마다 원본을 다시 그린다. 크기를 모를 때는 그대로
  // 둔다 — 두 변이 2048 이하인 사진은 프리뷰가 원래 원본이고, 그 사진에는 크기가 오지 않는다.
  const preview =
    size !== null && previewUrl === originalUrl ? null : previewUrl;
  const baseSrc =
    set && (preview === null || preview === brokenPreview)
      ? tileUrl(set, set.levels.length - 1, 0, 0)
      : preview;
  const ready = tiles.status === "original" ? originalLoaded : tilesReady;

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
            {ready ? t("imageOriginal.title") : t("imageOriginal.loading")}
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
        <div className="image-view-fullscreen-body" ref={setBody}>
          {tiles.status === "original" ? (
            <>
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
            </>
          ) : (
            <>
              {/*
                §397 바닥 요소 — 줌의 내용 요소이고 타일 레이어가 사각형을 재는 요소다. `pending` 에서
                `tiles` 로 넘어가도 이 자리의 같은 요소다(key 없음): 레이어는 바닥 요소를 피라미드마다 한 번
                읽으므로 src · 속성만 바꾸고 다시 붙이지 않는다. width · height 는 원본 크기 — 오늘 CSS
                (`max-width: 100%; height: auto`)가 원본을 맞추던 폭으로 맞춘다(spec 0078 G3 · D5). 세로는
                로드 전에는 그 속성의 비율, 로드 뒤에는 바닥 요소 이미지의 고유 비율을 따른다(2026-11-19 시스템
                WKWebView 프로브) — 프리뷰 · 타일은 원본을 정수 크기로 줄인 것이라 그 차이는 줄일 때의 반올림만큼이다.
                프리뷰가 없거나 로드에 실패하면 가장 작은 레벨의 타일이 바닥 요소다(D5) — 그 레벨은 두 변이
                모두 타일 크기 이하라 한 장(0, 0)에 든다(Rust `level_sizes`). 실패한 프리뷰를 그대로 두지 않는
                이유: 상자가 없는 바닥 요소에는 배치할 타일이 없어 레이어가 준비되지 않고, 헤더가 "원본 불러오는
                중…" 에 남는다. 그 타일마저 실패하면 `brokenPreview` 가 이미 그 값이라 src 도 그대로다.
              */}
              {baseSrc && (
                <img
                  alt={alt}
                  className={
                    tilesReady
                      ? "image-fullscreen-img"
                      : "image-fullscreen-img image-fullscreen-img-preview"
                  }
                  height={size?.height}
                  onError={() => setBrokenPreview(preview)}
                  ref={baseRef}
                  src={baseSrc}
                  width={size?.width}
                />
              )}
              {set && (
                <ImageTileLayer
                  baseRef={baseRef}
                  bodyRef={bodyRef}
                  onReady={() => setReadySet(set)}
                  set={set}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

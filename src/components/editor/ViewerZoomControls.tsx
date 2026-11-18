// §396 전체 화면 뷰어 헤더의 확대 묶음 `[−] [100%] [+]`. 배율 버튼은 맞춤(⌘0)으로 돌린다.
// 설계: dev/design/specs/0077-fullscreen-viewer-zoom-design.md (D4)
//
// 툴팁은 네이티브 `title` 이다 — 앱의 툴팁(`--z-tooltip`, 1060)은 이 묶음을 싣는 오버레이들의 뒤에
// 그려진다(mermaid.css · svg-block.css · media.css · journal-extras.css 의 `…-overlay` 넷이 z-index 9999).
// 클래스는 묶음 `{className}`, 세 버튼 모두 `{className}-btn`, 배율 버튼에 더해 `{className}-level`.

import type React from "react";

import type { ViewerZoom } from "../../hooks/use-viewer-zoom";

import { Minus, Plus } from "lucide-react";

import { useTranslation } from "../../i18n/useTranslation";
import { formatKeyForDisplay } from "../../keybindings/key-utils";

interface ViewerZoomControlsProps {
  className: string;
  zoom: ViewerZoom;
}

// ⌘0 on macOS, Ctrl+0 elsewhere — the same split `use-zoom.ts` applies, derived the way
// `StatusBar.tsx` derives `ZOOM_RESET_KEY`.
const FIT_KEY = formatKeyForDisplay(
  "Mod+0",
  navigator.platform.includes("Mac"),
);

export function ViewerZoomControls({
  className,
  zoom,
}: ViewerZoomControlsProps): React.JSX.Element {
  const { t } = useTranslation();
  // 클릭은 부모로 올리지 않는다 — 라이트박스는 오버레이(`PhotoLightbox` 의 `photo-lightbox-overlay`)
  // 클릭으로 닫힌다.
  const act = (run: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    run();
  };
  return (
    <div aria-label={t("viewerZoom.group")} className={className} role="group">
      <button
        aria-label={t("viewerZoom.out")}
        className={`${className}-btn`}
        disabled={!zoom.canZoomOut}
        onClick={act(zoom.zoomOut)}
        onMouseDown={keepFocus}
        title={t("viewerZoom.out")}
        type="button"
      >
        <Minus size={14} />
      </button>
      <button
        className={`${className}-btn ${className}-level`}
        onClick={act(zoom.reset)}
        onMouseDown={keepFocus}
        title={t("viewerZoom.fit", { key: FIT_KEY })}
        type="button"
      >
        {`${Math.round(zoom.scale * 100)}%`}
      </button>
      <button
        aria-label={t("viewerZoom.in")}
        className={`${className}-btn`}
        disabled={!zoom.canZoomIn}
        onClick={act(zoom.zoomIn)}
        onMouseDown={keepFocus}
        title={t("viewerZoom.in")}
        type="button"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

/** 버튼이 포커스를 가져가지 않게 한다 — 편집 전체화면에서 textarea 의 포커스 · 선택이 남아야 한다. */
function keepFocus(e: React.MouseEvent): void {
  e.preventDefault();
}

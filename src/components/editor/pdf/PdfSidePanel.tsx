// §282 PDF 사이드 레일 — 페이지 목록과 하이라이트 목록의 공통 프레임.
//
// 두 목록이 패널 하나를 나눠 쓰는 이유: 구조적으로 같은 것이다 — "현재 PDF
// 안으로 점프하는 인덱스, 스크롤 위치와 동기화, 클릭하면 이동". 패널을 둘로
// 나누면 토글 두 개·위치 정책 두 벌이 생기고, 둘을 동시에 켰을 때 화면을 어떻게
// 나눌지가 새 문제가 된다.
//
// ‼️ 배치 트릭은 PdfToolbar에서 그대로 가져왔다. 이 컴포넌트는 `.pdf-preview`
// 안(= 스크롤 컨테이너 안)에서 렌더되지만 `position: absolute`이고,
// `.pdf-preview`와 `.editor-area-scroll` 둘 다 `position`이 없어서 실제
// 컨테이닝 블록은 **스크롤 컨테이너 바깥**의 `.editor-area`다(layout.css:113).
// 그래서 페이지가 스크롤해도 레일은 제자리에 있고, 스크롤러의 `overflow: auto`에
// 잘리지도 않는다 — 상태를 App.tsx로 끌어올릴 필요가 전혀 없다는 뜻이다.
// 사이드카·pages·scrollToPage가 전부 PdfPreview 안에 있으므로 이것이 중요하다.
//
// 본문(pagesContent/highlightsContent)은 이 프레임이 만들지 않는다 — 목록
// 자체는 §282.1(페이지 썸네일) / §282.2(하이라이트)가 채운다.
import type { ReactNode } from "react";

import type { PdfRailTab } from "../../../stores/ui/ui";
import type { PdfRailResize } from "./use-pdf-rail-resize";

import { useTranslation } from "../../../i18n/useTranslation";
import {
  PDF_RAIL_MAX_WIDTH_PX,
  PDF_RAIL_MIN_WIDTH_PX,
  resolvePdfRailTab,
} from "./pdf-side-panel-utils";

export function PdfSidePanel({
  activeTab,
  highlightsContent,
  highlightsEnabled,
  onTabChange,
  pagesContent,
  resize,
}: {
  /** 스토어의 raw 선택값 — 표시용 해석은 resolvePdfRailTab이 한다. */
  activeTab: PdfRailTab;
  highlightsContent?: ReactNode;
  /** false면 하이라이트 탭 자체를 렌더하지 않는다 — §274 UX fix round 2의
   * "고장난 것처럼 보이는 컨트롤 금지"를 PdfToolbar와 같은 방식으로 적용한다
   * (disabled 탭은 "하이라이트가 꺼져 있다"로 읽힌다). */
  highlightsEnabled: boolean;
  onTabChange: (tab: PdfRailTab) => void;
  pagesContent?: ReactNode;
  /** §283 폭 조절 배선. 폭 자체는 이 컴포넌트가 쓰지 않는다 — CSS 변수로
   * `.pdf-side-panel`에 들어오고(PdfPreview가 내려준다), 여기서는 손잡이만
   * 그린다. */
  resize: PdfRailResize;
}) {
  const { t } = useTranslation();
  const resolved = resolvePdfRailTab(activeTab, highlightsEnabled);

  return (
    <aside
      aria-label={t("pdfSidePanel.label")}
      className="pdf-side-panel"
      data-testid="pdf-side-panel"
    >
      <div className="pdf-side-panel-tabs" role="tablist">
        <button
          aria-selected={resolved === "pages"}
          className={[
            "btn-unstyled",
            "pdf-side-panel-tab",
            resolved === "pages" ? "active" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid="pdf-rail-tab-pages"
          onClick={() => onTabChange("pages")}
          role="tab"
          type="button"
        >
          {t("pdfSidePanel.pages")}
        </button>

        {highlightsEnabled && (
          <button
            aria-selected={resolved === "highlights"}
            className={[
              "btn-unstyled",
              "pdf-side-panel-tab",
              resolved === "highlights" ? "active" : null,
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid="pdf-rail-tab-highlights"
            onClick={() => onTabChange("highlights")}
            role="tab"
            type="button"
          >
            {t("pdfSidePanel.highlights")}
          </button>
        )}
      </div>

      <div
        className="pdf-side-panel-body"
        data-testid="pdf-side-panel-body"
        role="tabpanel"
      >
        {resolved === "pages" ? pagesContent : highlightsContent}
      </div>

      {/* §283 폭 손잡이. separator 관례를 따른다 — 스크린 리더에 "지금 몇 px,
          범위는 얼마"가 읽히고, 방향키로도 조절된다(포인터가 없으면 드래그
          자체가 불가능하므로 키보드 경로가 없으면 이 기능은 존재하지 않는 것과
          같다). tabIndex=0이 레일에 정지점을 하나 더하지만, §282.4가 막으려던
          것은 **목록 길이에 비례해 늘어나는** 정지점이다 — 이건 하나다. */}
      <div
        aria-label={t("pdfSidePanel.resize")}
        aria-orientation="vertical"
        aria-valuemax={PDF_RAIL_MAX_WIDTH_PX}
        aria-valuemin={PDF_RAIL_MIN_WIDTH_PX}
        aria-valuenow={Math.round(resize.width)}
        className={[
          "pdf-side-panel-resizer",
          resize.isResizing ? "resizing" : null,
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="pdf-rail-resizer"
        onKeyDown={resize.onResizeKeyDown}
        onPointerDown={resize.onResizeStart}
        role="separator"
        tabIndex={0}
      />
    </aside>
  );
}

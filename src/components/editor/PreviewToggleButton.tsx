// §5.1 HTML·플러그인 프리뷰 파일의 프리뷰 ↔ 원본 토글 버튼. 활성 표면 안에 겹쳐 그린다
// (TabSurface의 `overlay` prop 주석 참조 — `.editor-area-scroll`의 CSS zoom 때문이다).
import { useTranslation } from "../../i18n/useTranslation";

interface PreviewToggleButtonProps {
  isSourceView: boolean;
  onClick: () => void;
}

export function PreviewToggleButton({
  isSourceView,
  onClick,
}: PreviewToggleButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      className="mode-toggle-btn html-view-toggle"
      onClick={onClick}
      title={t("htmlPreview.toggleTitle")}
      type="button"
    >
      {isSourceView
        ? t("htmlPreview.showPreview")
        : t("htmlPreview.showSource")}
    </button>
  );
}

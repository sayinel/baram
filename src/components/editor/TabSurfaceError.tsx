// §286 한 유지 표면이 실패했을 때 **그 표면 자리에만** 그려지는 대체 UI.
//
// 세 버튼이 하는 일이 서로 다르다 — 하나로 줄일 수 없는 이유:
//
//   재시도  서브트리 리마운트. 컨테이너를 재다 던지는 뷰처럼 **렌더 크래시**는 이걸로
//           실제 회복된다. 반면 lazy 청크 로드 실패에는 듣지 않는다: React의
//           `lazyInitializer`는 reject된 payload를 `_status = 2`로 굳히고 이후 factory를
//           다시 부르지 않으며, 실패한 URL은 브라우저 모듈 맵에도 실패로 남아 재요청되지
//           않는다. 그래서 아래 hint가 "안 되면 리로드"라고 적혀 있다.
//   탭 닫기 나머지 탭과 편집 중인 버퍼를 살린 채 앱을 다시 쓸 수 있게 하는 유일한 수단.
//           editor 스토어는 persist가 없어 리로드하면 열린 탭이 전부 사라진다.
//   리로드  모듈 맵이 오염된 경우의 실제 복구.
//
// 프레젠테이션 전용이다. 닫기와 리로드의 *동작*은 TabSurface가 주입한다 — 이 컴포넌트가
// `useEditorStore`나 `window.location`을 직접 만지면 자기 탭이 아니라 활성 탭을 닫는
// §288 규칙 2의 함정으로 되돌아가기 쉽고, jsdom에서 테스트할 수도 없다.
import { useTranslation } from "../../i18n/useTranslation";

interface TabSurfaceErrorProps {
  error: Error;
  onClose: () => void;
  onReload: () => void;
  onRetry: () => void;
}

export function TabSurfaceError({
  error,
  onClose,
  onReload,
  onRetry,
}: TabSurfaceErrorProps) {
  const { t } = useTranslation();

  return (
    <div className="tab-surface-error" data-surface-error>
      <p className="tab-surface-error-title">
        {t("editor.surfaceError.title")}
      </p>
      {/* 메시지를 그대로 보여준다. "Importing a module script failed."는 사용자에게도
          개발자에게도 이 실패를 다른 것과 구별해 주는 유일한 단서다. */}
      <p className="tab-surface-error-message">{error.message}</p>
      <p className="tab-surface-error-hint">{t("editor.surfaceError.hint")}</p>
      <div className="tab-surface-error-actions">
        <button
          data-surface-error-action="retry"
          onClick={onRetry}
          type="button"
        >
          {t("editor.surfaceError.retry")}
        </button>
        <button
          data-surface-error-action="close"
          onClick={onClose}
          type="button"
        >
          {t("editor.surfaceError.close")}
        </button>
        <button
          data-surface-error-action="reload"
          onClick={onReload}
          type="button"
        >
          {t("editor.surfaceError.reload")}
        </button>
      </div>
    </div>
  );
}

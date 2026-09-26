// §356 테마 미리보기 그림 — 팔레트 계약(`themes/theme-preview-palette.ts`)의 색으로 앱 화면을
// 줄여 그린다. 사이드바(활성 항목 하나) · 탭 바 · 편집기(제목 · 링크와 인라인 코드가 든 본문 ·
// 인용 · 코드 블록).
//
// 인라인 스타일에는 **색만** 싣는다. 크기·간격·경계선 굵기는 `styles/settings/theme.css` 의
// `.theme-preview-*` 가 갖는다 — 색은 테마마다 다른 데이터라 CSS 로 옮길 수 없지만, 모양은
// 모든 카드에 같다.
//
// 계약의 키를 빠짐없이 칠한다는 것은 `__tests__/theme-preview.test.tsx` 가 고정한다. 칠하지
// 않는 키는 레지스트리 색인이 싣게 될 죽은 필드가 된다.

import type {
  PreviewPalette,
  PreviewPalettes,
} from "../../../themes/theme-preview-palette";
import type { ThemeMode } from "../../../types/theme";

import { THEME_MODES } from "../../../types/theme";

/** 선언된 모드마다 한 칸, 라이트 · 다크 순서. 그릴 팔레트가 없으면 `null`. */
export function ThemePreview({ palettes }: { palettes: PreviewPalettes }) {
  const panes = THEME_MODES.flatMap((mode) => {
    const palette = palettes[mode];
    return palette === undefined
      ? []
      : [<PreviewPane key={mode} mode={mode} palette={palette} />];
  });
  if (panes.length === 0) return null;
  return (
    // 장식이다 — 숨기지 않으면 카드 button 의 accessible name 에 더미 글("Heading" …)이
    // 섞여 읽힌다(적대 리뷰).
    <div aria-hidden="true" className="theme-preview">
      {panes}
    </div>
  );
}

function PreviewPane({
  mode,
  palette: p,
}: {
  mode: ThemeMode;
  palette: PreviewPalette;
}) {
  return (
    <div
      className="theme-preview-pane"
      data-mode={mode}
      style={{ backgroundColor: p["--color-bg-default"] }}
    >
      <div
        className="theme-preview-sidebar"
        style={{
          backgroundColor: p["--color-bg-panel"],
          borderRightColor: p["--color-border-default"],
        }}
      >
        <div
          className="theme-preview-row"
          style={{ backgroundColor: p["--color-accent-subtle"] }}
        >
          <span
            className="theme-preview-line"
            style={{ backgroundColor: p["--color-text-primary"] }}
          />
        </div>
        <div className="theme-preview-row">
          <span
            className="theme-preview-line"
            style={{ backgroundColor: p["--color-text-secondary"] }}
          />
        </div>
        <div className="theme-preview-row">
          <span
            className="theme-preview-line theme-preview-line-short"
            style={{ backgroundColor: p["--color-text-secondary"] }}
          />
        </div>
      </div>
      <div className="theme-preview-main">
        <div
          className="theme-preview-tabs"
          style={{
            backgroundColor: p["--color-bg-subtle"],
            borderBottomColor: p["--color-border-default"],
          }}
        >
          <span
            className="theme-preview-tab"
            style={{
              backgroundColor: p["--color-editor-bg"],
              color: p["--color-editor-text"],
            }}
          >
            note
          </span>
          <span
            className="theme-preview-tab"
            style={{ color: p["--color-text-secondary"] }}
          >
            todo
          </span>
        </div>
        <div
          className="theme-preview-editor"
          style={{
            backgroundColor: p["--color-editor-bg"],
            color: p["--color-editor-text"],
          }}
        >
          <div className="theme-preview-heading">Heading</div>
          <div className="theme-preview-text">
            A <span style={{ color: p["--color-accent-default"] }}>link</span>{" "}
            and{" "}
            <span
              className="theme-preview-inline-code"
              style={{ backgroundColor: p["--color-bg-elevated"] }}
            >
              code
            </span>
          </div>
          <div
            className="theme-preview-quote"
            style={{
              borderLeftColor: p["--color-accent-default"],
              color: p["--color-text-secondary"],
            }}
          >
            Quote
          </div>
          <div
            className="theme-preview-code"
            style={{ backgroundColor: p["--color-bg-subtle"] }}
          >
            {"let x = 1;"}
          </div>
        </div>
      </div>
    </div>
  );
}

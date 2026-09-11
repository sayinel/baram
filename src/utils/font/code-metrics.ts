// §354 코드 서체의 크기·줄 높이 — 본문에서 파생하거나, 따로 정하거나.
//
// 연동(`linkFontMetrics`, 기본 켜짐) 중에는 코드 값을 **쓰지 않는다**. 본문
// 값에서 아래 비율로 계산한다. 그 비율은 새로 고른 숫자가 아니라 이 앱이 지금까지
// CSS 로 하고 있던 것을 값으로 옮긴 것이다 — `.tiptap code` 와 코드블록 편집기가
// `font-size: 0.875em` 이었고, 줄 높이는 본문에서 그대로 상속됐다. 그래서 연동
// 상태의 화면은 이 설정이 생기기 전과 픽셀 단위로 같다.
//
// 연동을 끄는 순간 그때의 파생값이 코드 값으로 적히고(그래야 슬라이더가 지금
// 보이는 크기에서 출발한다), 그때부터 독립이다. 다시 켜면 코드 값은 버려진다 —
// 연동 중에 읽히는 곳이 없으므로 "버린다"는 것은 규칙이 아니라 구조다.
//
// 왜 계산을 여기 하나로 모으는가: 네 곳(에디터 효과 · 설정 행의 예제 · 브라우저
// 미리보기 · 소스 모드)이 같은 답을 내야 한다. 비율을 각자 적으면 한 곳만 고쳐도
// 아무 테스트가 깨지지 않은 채 화면 넷이 서로 다른 크기를 보여 준다.

/** 코드 크기 = 본문 크기 × 이 값. `0.875em` 이라는 기존 CSS 가 출처다. */
export const CODE_FONT_SIZE_RATIO = 0.875;

export interface CodeMetrics {
  fontSize: number;
  lineHeight: number;
}

export interface FontMetricsSettings {
  codeFontSize: number;
  codeLineHeight: number;
  fontSize: number;
  lineHeight: number;
  linkFontMetrics: boolean;
}

/**
 * 본문 크기에서 파생한 코드 크기. **반올림하지 않는다.**
 *
 * 오늘의 `0.875em` 은 본문 17px 에서 14.875px 를 만든다. 여기서 반올림하면
 * 연동만 켜 둔 사용자의 화면이 이 설정이 생겼다는 이유만으로 바뀐다 — 연동
 * 상태가 "이전과 같다"는 것이 이 설계의 전제다. 정수가 필요한 곳은 슬라이더
 * 하나뿐이고, 반올림은 거기서(연동을 끄는 순간) 한다.
 */
export function derivedCodeFontSize(bodyFontSize: number): number {
  return bodyFontSize * CODE_FONT_SIZE_RATIO;
}

/** 지금 코드에 실제로 적용되는 크기·줄 높이. */
export function resolveCodeMetrics(s: FontMetricsSettings): CodeMetrics {
  if (!s.linkFontMetrics) {
    return { fontSize: s.codeFontSize, lineHeight: s.codeLineHeight };
  }
  return {
    fontSize: derivedCodeFontSize(s.fontSize),
    lineHeight: s.lineHeight,
  };
}

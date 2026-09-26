// §365 다이얼 6 — 본문 타이포의 범위와 서체 이름 검증(스펙 0060 §3). `dials.ts` 의 `DIALS` 가
// 네 항목(`editorFontFamily` · `editorCodeFontFamily` · `editorFontSize` · `editorLineHeight`)에서
// 읽고, 설정 행 · 검색 · 서체 브라우저 미리보기가 같은 범위를 읽는다.
//
// ‼️ 이 모듈은 아무것도 import 하지 않는다 — `dials.ts` 가 값으로 import 하므로, 여기에 import 를
// 더하면 그 파일 머리주석의 순환 부재 논증을 다시 재야 한다.

/** 본문 크기(px). 옮기기 전 설정 행과 검색 슬라이더의 범위 그대로다. */
export const EDITOR_FONT_SIZE_RANGE = { max: 32, min: 8, step: 1 } as const;

/** 본문 줄 높이(배수). 위와 같다. */
export const EDITOR_LINE_HEIGHT_RANGE = { max: 3, min: 1, step: 0.05 } as const;

/** 서체 이름의 길이 상한 — 저장분 · 매니페스트가 임의 길이 문자열을 적용 경로로 싣지 못하게. */
export const FONT_FAMILY_MAX_LENGTH = 128;

/**
 * 서체 이름 검증. 앞뒤 공백을 걷은 문자열을 돌려주고, 받을 수 없으면 `undefined`.
 *
 * `""` 는 유효하다 — "설정 없음"(토큰 스택을 쓴다)이고, 테마가 서체를 정한 상태에서 사용자가
 * 앱 기본으로 돌아가려면 사용자 층에 `""` 를 **명시**해야 한다.
 *
 * 제어 문자(U+0000–001F · U+007F)를 거부하는 이유: 이름은 `quoteFamily` 가 CSS 문자열 안에
 * 가두는데, 줄바꿈이 섞이면 문자열 토큰이 깨져 선언이 조용히 무효가 된다 — 저장값은 남고
 * 서체는 적용되지 않는다.
 */
export function parseFontFamily(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.trim();
  if (name.length > FONT_FAMILY_MAX_LENGTH) return undefined;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return undefined;
  }
  return name;
}

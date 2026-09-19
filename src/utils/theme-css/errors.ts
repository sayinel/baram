// §358 테마 CSS 거부 사유 — 코드로 던지고 화면에서 locale 문장으로 바꾼다.
// `use-theme-import.ts`가 같은 방식을 쓴다: Error 원문을 그대로 렌더하면 한국어
// UI에 영문 절반이 섞인다. 원문 상세는 logger에만 남는다.
//
// ‼️ 코드 하나는 **제작자가 할 수 있는 수정 하나**에 대응한다. 서로 다른 수정을
// 한 코드로 묶으면 화면이 거짓 원인을 알려 준다 — 로컬 `var()` 를 `absoluteUrl`
// 로 보고하던 것이 정확히 그 부류였고, 그래서 `substitutionNotAllowed` 가 있다.
//
// 타입이 아니라 배열이 원본이다: 타입만 있으면 "모든 코드에 문장이 붙는가" 를
// 런타임에 셀 수 없고, 그 검사는 `i18n/__tests__/label-key-coverage.test.ts` 에 있다.
export const THEME_CSS_ERROR_CODES = [
  /** 참조가 패키지 밖의 주소다 — 원격이거나, scheme 을 가졌거나, base 를 따라 움직이지 않는다. */
  "absoluteUrl",
  /** 패키지 상대 경로이긴 한데 그런 파일이 패키지에 없다. */
  "assetNotFound",
  /** 패키지 안의 파일을 가리키는 경로가 아니다 — 탈출·루트 절대·조각·쿼리. */
  "assetPathNotAllowed",
  /** 확장자가 허용 표에 없다. 확장자에서 media type 을 만들어 내지 않는다. */
  "assetTypeNotAllowed",
  /** `@import` — 설치 뒤에 임의의 CSS 를 끌어올 수 있다. */
  "importNotAllowed",
  /** CSS 를 끝까지 읽지 못했거나, 파서가 포기한 조각이 자원 이름을 숨기고 있다. */
  "parseFailed",
  /** 자원 이름 자리의 `var()`·`env()`·`attr()` — 설치 시점에 값을 증명할 수 없다. */
  "substitutionNotAllowed",
  /** 동봉 자산의 누적 바이트가 상한을 넘었다. */
  "tooLarge",
] as const;

export type ThemeCssErrorCode = (typeof THEME_CSS_ERROR_CODES)[number];

export class ThemeCssError extends Error {
  constructor(
    readonly code: ThemeCssErrorCode,
    /** 사람이 원인을 짚을 수 있는 조각 — 로그 전용. 화면에 그대로 내보내지 않는다. */
    readonly detail?: string,
  ) {
    super(code);
    this.name = "ThemeCssError";
  }
}

/**
 * 이 코드를 설명하는 i18n 키. 접두사의 유일한 집이다 — 화면 쪽에서 문자열을
 * 이어 붙이면 카탈로그와 어긋나도 아무것도 빨개지지 않고 키가 그대로 렌더된다.
 */
export function themeCssErrorKey(code: ThemeCssErrorCode): string {
  return `settings.appearance.themeCssError.${code}`;
}

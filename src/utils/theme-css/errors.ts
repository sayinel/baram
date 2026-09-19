// §358 테마 CSS 거부 사유 — 코드로 던지고 화면에서 locale 문장으로 바꾼다.
// `use-theme-import.ts`가 같은 방식을 쓴다: Error 원문을 그대로 렌더하면 한국어
// UI에 영문 절반이 섞인다. 원문 상세는 logger에만 남는다.
export type ThemeCssErrorCode =
  "absoluteUrl" | "importNotAllowed" | "parseFailed" | "tooLarge";

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

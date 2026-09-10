// §347 번들 서체의 단일 출처 — 이름·굵기 범위·파일명을 여기서만 적는다.
//
// 왜 한 곳인가: 이 두 이름을 토큰 스택·@font-face·가용성 판정·export 임베드·저널
// 테마가 모두 지목한다. 다섯 곳에 손으로 적으면 갈라지고, 갈라진 쪽은 조용히
// 폴백으로 렌더된다 — 그것이 §346 의 결함 그 자체였다.

export interface BundledFont {
  /** 정확한 CSS 패밀리명. @font-face 와 토큰 스택이 이 표기를 쓴다. */
  family: string;
  /** src/assets/fonts/ 안의 파일명. */
  fileName: string;
  /** @font-face 의 font-weight 범위 (가변 폰트). */
  weightRange: string;
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    family: "Pretendard Variable",
    fileName: "PretendardVariable.woff2",
    weightRange: "45 920",
  },
  {
    family: "JetBrains Mono Variable",
    fileName: "jetbrains-mono-latin-wght-normal.woff2",
    weightRange: "100 800",
  },
] as const;

/** 소문자 패밀리명 집합 — 가용성 판정이 대소문자 무시 비교에 쓴다. */
export const BUNDLED_FAMILY_KEYS: ReadonlySet<string> = new Set(
  BUNDLED_FONTS.map((f) => f.family.toLowerCase()),
);

// §347 번들 서체의 단일 출처 — 이름·굵기 범위·파일명을 여기서만 적는다.
//
// 왜 한 곳인가: 이 두 이름을 토큰 스택·@font-face·가용성 판정·export 임베드·저널
// 테마가 모두 지목한다. 다섯 곳에 손으로 적으면 갈라지고, 갈라진 쪽은 조용히
// 폴백으로 렌더된다 — 그것이 §346 의 결함 그 자체였다.
//
// 값뿐 아니라 **값을 꺼내는 방법**도 여기 있다(`bundledFont`/`bundledFamily`).
// 그 `find(role) → 없으면 throw → 인용` 관용구는 한때 세 파일에 손으로 복제돼
// 있었고 네 번째가 필요해졌다 — 복제본은 단일 출처라는 위의 주장을 조금씩
// 무효하게 만든다. 역할로 서체를 얻어야 하면 아래 두 함수를 쓸 것.

import { quoteFamily } from "../editor/quote-font-family";

export interface BundledFont {
  /** 정확한 CSS 패밀리명. @font-face 와 토큰 스택이 이 표기를 쓴다. */
  family: string;
  /** src/assets/fonts/ 안의 파일명. */
  fileName: string;
  /**
   * 이 서체의 라이선스 사본 — `src/assets/fonts/` 안의 파일명 (§347).
   *
   * 둘 다 OFL 1.1 이고, OFL 1.1 §2 는 재배포되는 **사본마다** 저작권 표기와
   * 라이선스가 함께 있을 것을 조건으로 단다. 그래서 이 파일명은 장식이 아니라
   * 배포 조건이다 — `font-licenses.ts` 가 이 이름으로 텍스트를 번들에 싣고,
   * About 모달이 그것을 보여 준다.
   */
  licenseFile: string;
  /**
   * 이 서체가 채우는 슬롯 — 본문(`--font-family-editor`)이냐 코드(`--font-family-mono`)냐.
   *
   * 배열 순서로 짚거나 이름에 "mono"가 들었는지로 추론하지 않는다: 순서는 아무
   * 것도 보장하지 않고, 이름 추론은 "Mononoki" 같은 본문 서체를 코드로 분류한다.
   * 역할은 선언되는 사실이므로 선언한다.
   */
  role: "body" | "code";
  /** @font-face 의 font-weight 범위 (가변 폰트). */
  weightRange: string;
}

export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    family: "Pretendard Variable",
    fileName: "PretendardVariable.woff2",
    licenseFile: "OFL-Pretendard.txt",
    role: "body",
    weightRange: "45 920",
  },
  {
    family: "JetBrains Mono Variable",
    fileName: "jetbrains-mono-latin-wght-normal.woff2",
    licenseFile: "OFL-JetBrainsMono.txt",
    role: "code",
    weightRange: "100 800",
  },
] as const;

/** 소문자 패밀리명 집합 — 가용성 판정이 대소문자 무시 비교에 쓴다. */
export const BUNDLED_FAMILY_KEYS: ReadonlySet<string> = new Set(
  BUNDLED_FONTS.map((f) => f.family.toLowerCase()),
);

/**
 * 역할별 번들 서체 — CSS 값이 아니라 메타데이터 전체가 필요할 때.
 *
 * 없는 역할을 물으면 던진다. 조용한 `undefined` 는 이름 없는 폴백 스택이 되고,
 * 그것은 시스템 서체로 조용히 렌더되어 §346 의 결함("이름만 있고 실물이
 * 없다")을 반대 방향으로 되살린다 — 모듈 초기화 시점의 큰 소리가 낫다.
 */
export function bundledFont(role: BundledFont["role"]): BundledFont {
  const font = BUNDLED_FONTS.find((f) => f.role === role);
  if (!font) throw new Error(`§347: no bundled font for the "${role}" role`);
  return font;
}

/**
 * 역할별 번들 서체의 CSS 표기 — 폴백 스택의 머리로 들어가는 값.
 *
 * `quoteFamily` 를 거치므로 다단어 이름이 `<custom-ident>` 로 오해되지 않는다.
 * 인용되지 않은 원문 이름이 필요하면 `bundledFont(role).family` 를 쓸 것
 * (예: 대소문자 무시 키로 쓰는 export 임베드).
 */
export function bundledFamily(role: BundledFont["role"]): string {
  return quoteFamily(bundledFont(role).family);
}

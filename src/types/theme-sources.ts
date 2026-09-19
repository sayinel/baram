// §356 테마 출처 — 행이 무엇을 할 수 있는지는 출처에서 파생된다.
//
// `src/plugins/plugin-sources.ts`가 플러그인에 대해 세운 규칙과 같다(스펙 0043 §5.3):
// 컴포넌트가 "내장이면 삭제 버튼을 숨긴다" 같은 판단을 각자 하지 않는다. 판단은
// 여기 한 번 있고, 새 출처가 생기면 컴파일러가 빠진 행을 짚는다.
//
// 플러그인 표와 달리 토글이 없다 — 테마는 동시에 하나만 활성이므로 켜고 끄는 것이
// 아니라 고르는 것이다.

export interface ThemeActionSet {
  /** 이 테마를 활성으로 만든다 */
  apply: boolean;
  /** 동의 이력 보기 — 레지스트리에서 받은 것만 */
  consentHistory: boolean;
  /** 복제해 편집 — 새 custom 테마를 만든다 */
  duplicate: boolean;
  /** 패키지로 내보내기 */
  export: boolean;
  /** 개발 폴더에서 다시 읽기 */
  reload: boolean;
  /** 제거. dev는 폴더 연결 해제를 뜻한다 */
  remove: boolean;
  /** 새 버전으로 갱신 */
  update: boolean;
}

/** `custom`은 플러그인에 대응물이 없다 — 앱 안에서 사용자가 만든 테마다. */
export type ThemeSource = "builtin" | "community" | "custom" | "dev";

const NONE: ThemeActionSet = {
  apply: false,
  consentHistory: false,
  duplicate: false,
  export: false,
  reload: false,
  remove: false,
  update: false,
};

const BY_SOURCE: Record<ThemeSource, ThemeActionSet> = {
  // 내장은 지울 수도 갱신할 수도 없다 — 바이너리에 동봉되어 있다.
  builtin: { ...NONE, apply: true, duplicate: true },
  community: {
    ...NONE,
    apply: true,
    consentHistory: true,
    duplicate: true,
    remove: true,
    update: true,
  },
  // 내보내기는 사용자가 만든 것에만 의미가 있다.
  custom: { ...NONE, apply: true, duplicate: true, export: true, remove: true },
  // dev는 디스크가 원본이므로 복제 편집 대신 다시 읽기다.
  dev: { ...NONE, apply: true, export: true, reload: true, remove: true },
};

export function themeActions(source: ThemeSource): ThemeActionSet {
  return BY_SOURCE[source];
}

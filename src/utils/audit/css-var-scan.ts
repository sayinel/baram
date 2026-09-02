// 이슈 515 — audit:css-vars의 스캔 코어. 순수 함수만 있고 fs·process에 닿지
// 않는다: 게이트 스크립트(scripts/audit-css-vars.ts)가 import해 쓰고, 같은
// 로직을 __tests__의 회귀 핀이 픽스처 문자열로 잠근다. 이슈의 수용 기준 —
// "주석 속 --x:는 정의로 세지 않는다"를 테스트로 고정 — 이 이 분리의 이유다:
// 게이트는 죽은 사용처가 존재하는 동안만 핀이고, 사용처를 고치는 순간 핀이
// 사라진다(적대 리뷰가 실측: stripCssComments를 되돌려도 CI는 초록불이었다).

/**
 * CSS 주석을 제거한다 — 정의·사용 수집 양쪽에 적용한다.
 *
 * 이슈 515: 생성 CSS의 설명 주석은 과거 이름을 "(was --color-bg-secondary: #f8f9fa)"
 * 형태로 남기는데, raw 정규식이 그 텍스트까지 정의로 수집해 **어디에도 선언되지 않은
 * 변수를 "정의됨"으로 분류**했다. 그 뒤에서 죽은 사용 10건이 이 감사를 통과했고,
 * 감사가 침묵하는 동안 새 위반이 계속 유입됐다. 토큰 이름이 바뀔 때마다 재발하는
 * 구조이므로, 매칭 전에 주석을 벗기는 것이 근본 수정이다. (사용 수집도 같이 벗긴다 —
 * 주석 속 var()가 사용으로 집계되면 이후 역방향 감사가 죽은 정의를 놓치게 된다.)
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * TS/TSX 주석을 벗긴다 — 블록 주석 전체와, 줄 머리가 주석인 줄만. 코드 뒤에 붙는
 * `// …` 트레일링 주석은 건드리지 않는다: 문자열 속 URL(`https://…`)을 주석으로
 * 오인하는 위양성이 실제 코드 손실보다 나쁘고, 지금까지의 오탐(svg-utils의 주석 속
 * `var(--x)` 예시)은 전부 줄 머리 주석이었다.
 */
export function stripTsComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** 주석을 벗긴 CSS에서 `--x:` 정의 이름들을 수집한다. */
export function collectCssDefinitions(css: string): Set<string> {
  const out = new Set<string>();
  for (const match of stripCssComments(css).matchAll(/--([\w-]+)\s*:/g)) {
    out.add(`--${match[1]}`);
  }
  return out;
}

/** 주석을 벗긴 CSS/TS 텍스트에서 `var(--x` 사용 이름들을 수집한다. */
export function collectVarUses(text: string, kind: "css" | "ts"): Set<string> {
  const stripped =
    kind === "css" ? stripCssComments(text) : stripTsComments(text);
  const out = new Set<string>();
  for (const match of stripped.matchAll(/var\(\s*--([\w-]+)/g)) {
    out.add(`--${match[1]}`);
  }
  return out;
}

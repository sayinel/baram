// §365.2 다이얼 4·5 가 설 땅. 이 파일은 "간격·모서리 선언이 **계산하면** 몇 px 인가" 를
// 답하는 하나의 함수를 낸다 — 그 답이 리팩터 전후로 같아야 값이 안 바뀐 것이다.
//
// ‼️ 토큰 값은 `generated/primitives.css` 에서 **파싱한다**. 손으로 적으면 Style
// Dictionary 가 값을 바꾼 날 이 파일만 옛 값을 알고 스냅샷은 그대로 초록이다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cssDeclarations, cssRules } from "./css-rules";

const PRIMITIVES = resolve(__dirname, "../generated/primitives.css");

function tokenTable(prefix: string): Record<string, string> {
  const src = readFileSync(PRIMITIVES, "utf8");
  const out: Record<string, string> = {};
  for (const m of src.matchAll(
    new RegExp(`^\\s*(--${prefix}-[a-z0-9-]+):\\s*([^;]+);`, "gmu"),
  )) {
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}

export const SPACE_TOKENS: Readonly<Record<string, string>> =
  tokenTable("space");
export const RADIUS_TOKENS: Readonly<Record<string, string>> =
  tokenTable("radius");

/**
 * 이 계획이 다루는 속성. `border-radius` 계열은 접두 네 방향까지 포함한다.
 *
 * `stylelint.config.mjs` 의 `declaration-property-value-disallowed-list` 키와
 * **같은 집합**이어야 한다 — 관문이 잡는 것과 스냅샷이 지키는 것이 갈리면, 그
 * 차집합에 들어온 선언은 관문은 빨갛게 만드는데 스냅샷은 값이 바뀌어도 초록이다.
 * 두 정규식의 본문은 그 규칙의 두 키와 글자가 같다(`0c4209bf` 가 맞췄다). 그 일치를
 * 검사하는 테스트는 없다 — 한쪽을 고치면 다른 쪽도 손으로 고친다.
 */
const SPACING_PROPS = /^(padding|margin|gap|row-gap|column-gap)(-[a-z]+)*$/u;
const RADIUS_PROPS = /^border(-[a-z]+)*-radius$/u;

/**
 * 간격·모서리 선언 하나하나를 **계산된 px** 로 펴서 정렬해 돌려준다.
 *
 * `var(--space-2)` 와 `8px` 은 같은 줄을 낸다 — 그것이 이 함수의 요점이다.
 * 리팩터가 값을 보존했다면 이 배열은 한 줄도 움직이지 않는다.
 *
 * ‼️ 푸는 것은 `var(--space-*)`·`var(--radius-*)` 참조뿐이고, 값 안 어디에 있든
 * 푼다 — `calc(…)`·`clamp(…)` 안에 있는 참조도 푼다. 리터럴은 어디에 있든 풀지
 * 않는다(R-C 가 남긴 `calc()` 안의 px · 백분율 · `em`·`rem` · 음수): 그대로 문자열로
 * 싣는다 — 그래야 그것들이 **변하지 않았음**도 함께 고정된다. 이름 바로 뒤에 `)` 가
 * 오지 않는 참조(fallback 을 단 `var(--space-2, 8px)`)와 속성의 축이 아닌 표의 이름
 * (`padding` 에 쓴 `var(--radius-sm)`)도 풀지 않고 `var(…)` 글자 그대로 싣는다.
 */
export function resolvedSpacingDeclarations(): string[] {
  const lines: string[] = [];
  for (const rule of cssRules()) {
    // ‼️ `cssDeclarations` 는 튜플이 아니라 `{ prop, value }[]` 를 돌려준다
    // (`css-rules.ts` 의 `cssDeclarations` 반환 타입). 구조분해를 배열로 쓰면 컴파일이 멎는다.
    for (const { prop, value } of cssDeclarations(rule.body)) {
      const isSpacing = SPACING_PROPS.test(prop);
      const isRadius = RADIUS_PROPS.test(prop);
      if (!isSpacing && !isRadius) continue;
      const table = isSpacing ? SPACE_TOKENS : RADIUS_TOKENS;
      const resolved = value.replaceAll(
        /var\((--(?:space|radius)-[a-z0-9-]+)\)/gu,
        (whole, name: string) => table[name] ?? whole,
      );
      lines.push(`${rule.file}|${rule.selector}|${prop}|${resolved}`);
    }
  }
  return lines.sort();
}

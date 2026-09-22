// §364 병합 결과를 `<html>` 인라인 커스텀 프로퍼티로 쓴다. 인라인이므로 모든
// CSS 를 이긴다 — 그것이 테마 CSS 가 `@layer baram-theme` 에 갇힌 이 앱에서
// 외관 값이 실제로 도달하는 유일한 통로다(스펙 0055 §1.2).

import type { DialContext, DialId } from "./dials";
import type { ResolvedDial } from "./merge";

import { DIALS } from "./dials";

/**
 * 출처가 `default` 가 **아닌** 다이얼의 변수만 쓴다.
 *
 * ‼️ 기본값을 쓰지 않는 것이 성능 최적화가 아니라 정확성 조건이다. `system` 테마는
 * 인라인 변수를 하나도 쓰지 않고 `prefers-color-scheme` 에 맡기는데(`theme-vars.ts`
 * 의 `CASCADE_ONLY_THEME_IDS`), 기본값을 인라인으로 고정하면 그 미디어 쿼리를
 * 눌러 이긴다. 같은 파일 주석이 테마 편집기에서 그 사고가 실제로 일어났다고 적는다.
 */
export function applyDialVars(
  root: HTMLElement,
  resolved: Record<DialId, ResolvedDial>,
  ctx: DialContext,
): void {
  for (const dial of DIALS) {
    // ‼️ 색 채널은 여기서 쓰지 않는다 — 작성자가 하나여야 한다(Task 4).
    // `clearDialVars` 도 같은 필터를 쓴다: 쓰지 않는 것을 지우면 테마 이펙트가
    // 방금 쓴 값을 이 함수가 걷어 간다.
    //
    // ‼️ `!== "layout"` 이지 `=== "color"` 가 아니다 — 처음 쓰일 때의 이유는
    // 타입이었다(§364 당시 `DIALS` 는 원소 전부가 `channel: "layout"` 이라
    // `=== "color"` 가 TS2367, 겹치지 않는 리터럴 비교로 멎었다). §367 이 색
    // 다이얼 둘을 들이면서 그 제약은 사라졌고, 지금 이 형태를 지키는 이유는
    // `clearDialVars` 와 **같은 술어여야 한다**는 것뿐이다 — 둘이 갈리면 쓰는
    // 집합과 지우는 집합이 어긋난다.
    if (dial.channel !== "layout") continue;
    const current = resolved[dial.id];
    // 말하지 않은 층뿐인 다이얼은 cascade 에 맡긴다.
    const emitted =
      current.origin === "default" ? {} : dial.toVars(current.value, ctx);
    for (const name of dial.vars) {
      const value = emitted[name];
      // `undefined` 를 setProperty 에 넘기면 리터럴 "undefined" 커스텀 프로퍼티가
      // 되어 cascade 기본값을 가린다(`applyThemeVars` 의 같은 주석).
      if (value === undefined) root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
  }
}

/** {@link applyDialVars} 가 쓸 수 있는 변수를 전부 지워 cascade 가 다시 지배하게 한다. */
export function clearDialVars(root: HTMLElement): void {
  for (const dial of DIALS) {
    if (dial.channel !== "layout") continue;
    for (const name of dial.vars) root.style.removeProperty(name);
  }
}

/**
 * §367 색 채널 다이얼이 내는 시드 오버라이드 — {@link applyDialVars} 가 건너뛰는
 * 쪽을 맡는 짝이다. 다만 **쓰지 않고 돌려준다**: `--color-*` 인라인의 작성자는 테마
 * 이펙트 하나여야 하고(`DialBase.channel` 의 주석이 그 이유를 적는다), 그 이펙트가
 * 이 결과를 시드 위에 얹은 뒤 파생을 계산한다.
 *
 * `channel` 이 두 값뿐이므로 여기의 `=== "layout"` 과 {@link applyDialVars} 의
 * `!== "layout"` 은 같은 집합을 가른다. 저쪽이 부정형인 것은 이력 때문이고
 * (그 자리 주석이 적는다), 여기서는 긍정형이 읽기 쉬워 그대로 둔다.
 */
export function colorDialVars(
  resolved: Record<DialId, ResolvedDial>,
  ctx: DialContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dial of DIALS) {
    if (dial.channel === "layout") continue;
    const current = resolved[dial.id];
    // 말하지 않은 층뿐인 다이얼은 cascade 에 맡긴다 — `applyDialVars` 와 같은 규칙.
    if (current.origin === "default") continue;
    Object.assign(out, dial.toVars(current.value, ctx));
  }
  return out;
}

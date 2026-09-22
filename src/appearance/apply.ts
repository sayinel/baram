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
    // ‼️ `!== "layout"` 이지 `=== "color"` 가 아니다 — 실측 근거는 Task 1 브리프
    // Step 8 끝: 이 시점의 `DIALS` 는 여섯 원소 전부 `channel: "layout"` 이라
    // `=== "color"` 는 TS2367(겹치지 않는 리터럴 비교)로 멎는다.
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

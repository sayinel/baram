// §364 병합 결과를 `<html>` 인라인 커스텀 프로퍼티로 쓴다. 인라인이므로 모든
// CSS 를 이긴다 — 그것이 테마 CSS 가 `@layer baram-theme` 에 갇힌 이 앱에서
// 외관 값이 실제로 도달하는 유일한 통로다(스펙 0055 §1.2).

import type { DialContext, DialId } from "./dials";
import type { ResolvedDial } from "./merge";

import { ACCENT_AXIS_DIAL_IDS, accentFamilyVars, DIALS } from "./dials";

/**
 * {@link colorDialVars} 의 일반 순회가 건너뛰는 다이얼 — 강조의 두 축이다.
 * `Object.values` 에서 짓는다: 이름을 두 번 적으면 한쪽만 고치는 날이 온다.
 */
const ACCENT_AXES: ReadonlySet<string> = new Set(
  Object.values(ACCENT_AXIS_DIAL_IDS),
);

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
 * **색** 채널을 맡는 짝이다. 다만 **쓰지 않고 돌려준다**: `--color-*` 인라인의 작성자는 테마
 * 이펙트 하나여야 하고(`DialBase.channel` 의 주석이 그 이유를 적는다), 그 이펙트가
 * 이 결과를 시드 위에 얹은 뒤 파생을 계산한다.
 *
 * 채널은 셋이다(`color` · `editor` · `layout`). 여기는 `color` 만 받고 {@link applyDialVars} 는
 * `layout` 만 쓴다 — `editor` 는 어느 쪽도 쓰지 않는다(소비자가 병합값을 읽는다, 스펙 0060
 * D3). 그래서 술어가 `!== "color"` 다: 예전의 `=== "layout"` 은 채널이 둘일 때만 같은 집합을
 * 갈랐고, 셋째 채널을 색 순회에 흘려 넣는다(`apply-channels.test.ts` 가 그 호출을 센다).
 *
 * ‼️ 색 다이얼 전부가 이 순회로 처리되는 것은 **아니다** — 강조의 두 축은 한 계산으로
 * 빠져 있고, 그 이유는 아래 그 자리에 적는다.
 */
export function colorDialVars(
  resolved: Record<DialId, ResolvedDial>,
  ctx: DialContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dial of DIALS) {
    if (dial.channel !== "color") continue;
    // ‼️ 강조의 두 축은 이 순회에서 **빠진다** — 아래에서 한 번에 계산한다.
    if (ACCENT_AXES.has(dial.id)) continue;
    const current = resolved[dial.id];
    // 말하지 않은 층뿐인 다이얼은 cascade 에 맡긴다 — `applyDialVars` 와 같은 규칙.
    if (current.origin === "default") continue;
    Object.assign(out, dial.toVars(current.value, ctx));
  }
  // ‼️ **`accentHueShift` 와 `accentSaturationShift` 는 한 색의 두 축이다.** 다이얼이
  // 둘이라는 사실을 `DIALS` 순회에 맡겼던 것이 리뷰 C1 의 결함이다: 둘 다 강조 시드
  // 네 키를 **전부** 내므로 `DIALS` 에서 뒤에 오는 쪽이 앞의 결과를 통째로 덮었고,
  // 채도를 이미 옮겨 둔 상태에서 색상 슬라이더를 끌면 값은 저장되면서 화면은 변하지
  // 않았다(실측: 기본 라이트 시드에 `accentHueShift: 60` + `accentSaturationShift: -40`
  // 의 출력이 채도만 준 출력과 바이트 단위로 같았다).
  //
  // 계산 한 번이 그 결합을 구조로 만든다 — `DIALS` 의 순서에 의존하지 않는다.
  // `accentFamilyVars` 는 두 이동량이 모두 0 이면 빈 맵을 돌려주므로, 둘 다 기본값일
  // 때 강조 계열을 내지 않는 희소성(§364.2)도 그대로다.
  Object.assign(
    out,
    accentFamilyVars(
      {
        h: accentAxisShift(resolved, ACCENT_AXIS_DIAL_IDS.h),
        s: accentAxisShift(resolved, ACCENT_AXIS_DIAL_IDS.s),
      },
      ctx,
    ),
  );
  return out;
}

/**
 * 강조 축 하나의 이동량. 말하지 않은 층뿐이면 0 이다 — 위 루프의
 * `origin === "default"` 건너뛰기와 **같은 규칙**이지만, 축 둘이 한 계산을 공유하므로
 * 건너뛰기가 아니라 값으로 표현해야 한다(한 축만 기본값인 경우가 있다).
 */
function accentAxisShift(
  resolved: Record<DialId, ResolvedDial>,
  id: DialId,
): number {
  const current = resolved[id];
  if (current.origin === "default") return 0;
  // `parse` 와 `toVars` 를 짝지어 주는 타입은 없다(`dials.ts` 의 같은 주석) — 낡은
  // 저장분이나 적대적 매니페스트에서 숫자가 아닌 값이 도달하면 그 축은 움직이지
  // 않은 것으로 친다.
  return typeof current.value === "number" ? current.value : 0;
}

// §54 Theme System — the one place that applies a theme to the document (#330)
//
// Themes used to be applied by iterating ThemeColors at each call site while a
// separate hand-listed array did the clearing. The two drifted: the clear list
// covered 16 of the 25 keys, so nine overrides survived a switch back to a default
// theme. Both lists are now derived from THEME_COLOR_KEYS, and the foregrounds
// derived from the theme's own colours live here too, so a colour and the
// foreground computed from it can never be applied out of step.
//
// §358 이 모듈은 이제 두 가지를 적용한다: `<html>` 의 인라인 CSS 변수와, 테마가 실어
// 보낸 CSS 를 담는 `<style data-baram-theme>` 한 장. `<style>` 도 여기 있는 이유는
// 변수가 여기 있는 이유와 같다 — 붙이는 곳과 떼는 곳이 갈리면 #330 이 다시 난다.
// 짝이 맞는지는 `__tests__/theme-vars.test.ts` 가 목록이 아니라 **문서 스냅샷**으로
// 고정한다: 적용했다가 지우면 문서가 원래대로 돌아와야 한다.

import type { ThemeColors } from "../types/theme";

import {
  deriveColorVars,
  DERIVED_COLOR_KEYS,
} from "../appearance/color-derive";
import { THEME_COLOR_KEYS } from "../types/theme";
import {
  accentSolidFill,
  onSolidForeground,
  solidHoverFill,
} from "./color-contrast";
import { logger } from "./logger";
import { verifyStoredThemeCss } from "./theme-css/verify";

/** Status families that are used as a filled surface with text on them. */
const STATUS_FAMILIES = ["danger", "success", "warning"] as const;

/**
 * §358 테마 CSS 를 담은 `<style>` 의 소유자 표식. 플러그인이 `data-baram-plugin` 으로
 * 제 것을 표시하는 관례와 같다(`plugins/trusted/ui-api.ts`) — 붙일 때 적고, 뗄 때
 * 이 속성으로 찾는다.
 */
const THEME_STYLE_ATTR = "data-baram-theme";

/**
 * CSS variables computed from a theme rather than stored in it.
 *
 * Deliberately not ThemeColors keys: they are consequences of the colours the user
 * does pick, so exposing them in the theme editor would let a user save a pairing
 * that fails contrast. `src/styles/generated/` carries the matching values for the
 * default themes and for `system`, which apply no inline overrides at all.
 *
 * §367 이후 파생 목록은 둘이다. 이것은 **대비를 보장하는** 전경·채움(#330)이고,
 * `appearance/color-derive.ts` 의 `DERIVED_COLOR_KEYS` 는 색상환에서 계산한 의미
 * 색 29키다. 둘 다 `applyThemeVars` 가 쓰고 `clearThemeVars` 가 지운다.
 */
export const DERIVED_KEYS = [
  "--color-accent-on-solid",
  "--color-accent-solid",
  "--color-accent-solid-hover",
  // Spelled out rather than generated from STATUS_FAMILIES: spreading a mapped
  // array widens those elements to `string`, so a typo in the template would
  // compile clean and only surface as a variable nothing reads.
  "--color-status-danger-on-solid",
  "--color-status-danger-solid-hover",
  "--color-status-success-on-solid",
  "--color-status-success-solid-hover",
  "--color-status-warning-on-solid",
  "--color-status-warning-solid-hover",
] as const;

/**
 * Themes whose values come from `src/styles/generated/` instead of inline variables.
 *
 * `system` is here because it deliberately sets no `data-theme` and lets the
 * `prefers-color-scheme` cascade decide; the two defaults are here because the
 * generated stylesheets already carry their palette, including the derived accent
 * pairing {@link derivedVars} computes for everyone else.
 */
const CASCADE_ONLY_THEME_IDS: ReadonlySet<string> = new Set([
  "default-dark",
  "default-light",
  "system",
]);

/**
 * Does this theme carry inline variables, or does the generated cascade own it?
 *
 * Shared so that whoever restores a theme uses the same rule as whoever applied it.
 * The theme editor did not: it restored by SETTING the source colours, which pins a
 * cascade-only theme's palette inline where it outranks the media query — visibly
 * so on `system` under an OS dark theme, where the editor's `default-light` fallback
 * left the UI light until the user switched themes (#330 follow-up).
 */
export function appliesInlineVars(themeId: string): boolean {
  return !CASCADE_ONLY_THEME_IDS.has(themeId);
}

/**
 * Is the theme editor currently the owner of `<html>`'s inline variables?
 *
 * Only ever true while ThemeEditor is mounted. It exists so the settings effect's
 * `prefers-color-scheme` listener can stand down instead of wiping a live preview;
 * the reasoning for that lives at its call site (use-settings-effects.ts).
 */
let previewOwned = false;

/** Who wants to know when the preview lets go. See {@link subscribeThemePreviewRelease}. */
const previewReleaseListeners = new Set<() => void>();

/**
 * Claim (`true`) or release (`false`) the ownership {@link themePreviewOwned} reports.
 *
 * Releasing NOTIFIES (external review #1) — see {@link subscribeThemePreviewRelease} for
 * what could not be recovered without it.
 */
export function setThemePreviewOwner(owned: boolean): void {
  if (previewOwned === owned) return;
  previewOwned = owned;
  // A copy: a listener may unsubscribe itself while being notified.
  if (!owned) for (const listener of [...previewReleaseListeners]) listener();
}

/**
 * Run `listener` when the theme editor stops owning `<html>`.
 *
 * ‼️ THIS EXISTS BECAUSE ONE SKIPPED APPLY HAD NO RECOVERY PATH (external review #1). The
 * settings effect stands down while a preview is live, and the comment at its listener says
 * skipped transitions are not lost — closing the editor calls `restorePreview()`, saving
 * re-runs the effect. Both are true of an OS light/dark switch, which only moves inline
 * variables and `data-theme`, and both are FALSE of a community theme's CSS arriving from
 * the hydration hook:
 *
 * - `restorePreview` deliberately does not touch `<style data-baram-theme>` —
 *   {@link clearThemeCss}'s own doc comment records why, and its `lookupThemes` call omits
 *   the cache argument, so it has no CSS to restore even in principle;
 * - closing WITHOUT saving changes no dependency of that effect, so nothing re-runs it.
 *
 * So a theme whose CSS landed while the editor was open would have stayed colour-only until
 * something unrelated moved. This is the signal that closes it.
 */
export function subscribeThemePreviewRelease(listener: () => void): () => void {
  previewReleaseListeners.add(listener);
  return () => previewReleaseListeners.delete(listener);
}

/** @see setThemePreviewOwner */
export function themePreviewOwned(): boolean {
  return previewOwned;
}

/**
 * §358 테마가 실어 보낸 CSS 를 `<style data-baram-theme>` 한 장으로 문서에 붙인다.
 * `css` 가 없거나 계약을 지키지 않으면 아무것도 붙이지 않고, 앞 테마의 것을 뗀다.
 *
 * ‼️ 검증이 **여기** 있는 이유: 호출자에게 맡기면 "검증하지 않은 주입" 이라는 경로가
 * 생긴다. 이 모듈이 `<style>` 을 붙이는 유일한 곳인 것과 같은 이유다.
 *
 * 거부는 조용하지 않다 — 테마가 색은 그대로인데 CSS 만 사라지는 증상은 로그 없이는
 * 진단할 수 없다. 사용자에게 다시 물을 수 있는 시점(설치)은 이미 지났으므로 던지지
 * 않는다: 로드 시점의 예외는 테마 하나가 앱 시작을 막는다는 뜻이다.
 */
export function applyThemeCss(root: Document, css: string | undefined): void {
  const attached = root.querySelector<HTMLStyleElement>(
    `style[${THEME_STYLE_ATTR}]`,
  );
  // ‼️ 같은 바이트면 검증도 건너뛴다 — **이미 주입된 것에 한해서**(외부 리뷰 #3).
  //
  // 왜 안전한가. 이 `<style>` 에 들어 있는 문자열이 거기 있는 이유는 **이 함수가 아래에서
  // 검증에 통과시킨 뒤 넣었기 때문**이다. 이 모듈이 `<style data-baram-theme>` 를 붙이는
  // 유일한 곳이고(머리주석), 문자열은 불변이며, `textContent` 는 넣은 값을 그대로 돌려준다.
  // 그러니 같은 문자열을 다시 검증하는 것은 **같은 술어를 같은 값에** 또 적용하는 일이고,
  // 결과가 달라질 수 있는 입력이 없다.
  //
  // 왜 값어치가 있는가. 실측(외부 리뷰 검증 문서, 이 리포 `.superpowers/…`): 4 MiB 상한
  // 근처의 저장 CSS 에서 `verifyStoredThemeCss` 한 번이 122~352 ms 이고, 그 뒤에 있는
  // 문자열 비교는 0.066 ms 다. 그리고 **CSS 를 실은 커뮤니티 테마는 시작할 때마다 이
  // 비용을 두 번 낸다** — 하이드레이션이 `readStoredThemeCss` 에서 한 번 검증하고,
  // 캐시가 차면 이 이펙트가 다시 돌아 같은 바이트를 또 검증한다.
  //
  // ‼️ **검증을 없애는 것이 아니다.** 아직 붙지 않은 바이트는 전부 아래를 지난다. 그 경로가
  // 죽지 않은 이유가 있다: `customThemes[i].modes[mode].css` 는 `config.json` 에 영속되고
  // 리하이드레이트 때 아무도 다시 보지 않으므로, 손으로 고친 설정 파일이 실어 오는 CSS 는
  // `readStoredThemeCss` 가 구조적으로 볼 수 없고 오직 이 관문만이 본다.
  if (css !== undefined && attached !== null && attached.textContent === css) {
    return;
  }
  if (css === undefined || !verifyStoredThemeCss(css)) {
    if (css !== undefined) {
      logger.error("[theme] stored CSS failed verification — not injected");
    }
    clearThemeCss(root);
    return;
  }
  const style = attached ?? root.createElement("style");
  if (attached === null) {
    style.setAttribute(THEME_STYLE_ATTR, "");
    root.head.appendChild(style);
  }
  // 동등성 관문: `textContent` 대입은 값이 같아도 스타일시트를 다시 파싱시킨다.
  if (style.textContent !== css) style.textContent = css;
}

/** Write a theme's colours and every foreground derived from them to `root`. */
export function applyThemeVars(
  root: HTMLElement,
  colors: ThemeColors,
  base: "dark" | "light",
): void {
  // 감사 BLOCKER: `colors`를 순회하지 않고 whitelist를 순회한다. 사용자가 import한
  // 테마 JSON은 여기까지 흘러오는 외부 입력이고, `Object.entries(colors)`는 그 안에
  // 끼어든 임의 키(`display` 같은 진짜 CSS 속성 포함)를 <html>의 inline style에
  // 그대로 박는다 — clearThemeVars는 알려진 키만 지우므로 그 주입은 테마를 바꿔도
  // 영구히 남는다. 입구(import)에서도 걸러내지만, 이 함수가 최후 방어선이다.
  for (const { key } of THEME_COLOR_KEYS) {
    const value = colors[key];
    // 타입은 total이지만 저장분은 runtime cast다 — 옛 버전이 저장한 테마나
    // 앞으로 THEME_COLOR_KEYS에 키가 추가될 때 값이 빠질 수 있다. undefined를
    // setProperty에 넘기면 리터럴 "undefined" custom property가 되어 cascade
    // 기본값을 가리므로(적대 리뷰), 빠진 키는 쓰지 않는다 — 입력을 순회하던
    // 이전 동작과 같이 cascade가 지배한다.
    if (value !== undefined) root.style.setProperty(key, value);
  }
  for (const [key, value] of Object.entries(derivedVars(colors, base))) {
    root.style.setProperty(key, value);
  }
  // §367 시드에서 계산되는 의미 고정 계열 29키. `derivedVars` 와 나란히 두는 이유는
  // 둘 다 "시드의 결과" 이기 때문이고, 나누는 이유는 서로 다른 질문에 답하기
  // 때문이다 — `derivedVars` 는 대비를 보장하는 전경/채움이고(#330), 이쪽은
  // 색상환에서 계산한 의미 색이다. 대비 하한이 없는 쪽이 이쪽이다.
  for (const [key, value] of Object.entries(deriveColorVars(colors))) {
    root.style.setProperty(key, value);
  }
}

/**
 * §358 Remove the `<style>` {@link applyThemeCss} can attach.
 *
 * ‼️ `clearThemeVars` 와 짝이지만 **한 함수가 아니다**. `ThemeEditor.tsx` 의
 * `restorePreview` 는 색이 있으면 `applyThemeVars`, 없으면 `clearThemeVars` 로 갈리는데,
 * 토큰 없이 CSS 만 실은 모드(§355 가 허용한다)가 정확히 그 `clearThemeVars` 갈래로
 * 간다 — 그 함수가 `<style>` 까지 뗀다면 편집기를 닫는 것만으로 그 테마의 CSS 가
 * 사라지고, `restorePreview` 는 그것을 다시 붙일 줄 모른다. 대신 "적용한 것이 전부
 * 되돌아오는가" 는 `__tests__/theme-vars.test.ts` 가 목록이 아니라 문서 스냅샷으로
 * 고정한다.
 */
export function clearThemeCss(root: Document): void {
  // querySelectorAll 로 찾는다 — 한 장만 유지하는 것이 계약이지만, 어긋난 날 하나가
  // 남아 앞 테마를 계속 그리는 것이 #330 의 증상 그대로다.
  for (const style of root.querySelectorAll(`style[${THEME_STYLE_ATTR}]`)) {
    style.remove();
  }
}

/** Remove every variable {@link applyThemeVars} can set, so the cascade governs again. */
export function clearThemeVars(root: HTMLElement): void {
  for (const { key } of THEME_COLOR_KEYS) {
    root.style.removeProperty(key);
  }
  for (const key of DERIVED_KEYS) {
    root.style.removeProperty(key);
  }
  // ‼️ 이 루프가 빠지면 테마를 바꿔도 앞 테마의 callout·graph·git 색이 남는다 —
  // #330 이 정확히 그 모양이었다(제거 목록이 25키 중 16키만 덮어 아홉이 살아남았다).
  // 목록이 `color-derive.ts` 에서 오는 것이 그 재발을 막는다: 규칙을 더하면
  // 지우는 목록도 함께 자란다.
  for (const key of DERIVED_COLOR_KEYS) {
    root.style.removeProperty(key);
  }
}

/**
 * Every foreground and fill this module computes from a theme's own colours.
 *
 * The status families get the same treatment as the accent because they are also
 * user-editable (`THEME_COLOR_KEYS`, category "Status"). They need no `-solid` fill
 * of their own: unlike the accent, no status colour is stepped — only the text on
 * it is chosen.
 */
export function derivedVars(
  colors: ThemeColors,
  base: "dark" | "light",
): Record<string, string> {
  const solid = accentSolidFill(
    colors["--color-accent-default"],
    colors["--color-accent-hover"],
    base,
  );
  const derived: Record<string, string> = {
    "--color-accent-on-solid": onSolidForeground(solid),
    "--color-accent-solid": solid,
    "--color-accent-solid-hover": solidHoverFill(solid),
  };
  for (const family of STATUS_FAMILIES) {
    const fill = colors[`--color-status-${family}`];
    derived[`--color-status-${family}-on-solid`] = onSolidForeground(fill);
    // Derived rather than expressed as a `color-mix` in the stylesheet, because the
    // direction depends on which foreground the fill took: Solarized's `#dc322f`
    // takes white, every other theme's danger takes black, and a constant direction
    // breaks whichever group it moves toward.
    derived[`--color-status-${family}-solid-hover`] = solidHoverFill(fill);
  }
  return derived;
}

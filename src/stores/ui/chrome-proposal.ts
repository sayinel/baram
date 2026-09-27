// §370.3 테마가 **제안하는** 초기 크롬 가시성 — 제안이지 강제가 아니다.
//
// 왜 `ui.ts` 가 아닌가: 이 함수는 설치된 테마의 매니페스트를 읽어야 하고 그것은
// settings 스토어에 있다. `ui.ts` 는 오늘 `zustand` 말고 아무것도 import 하지 않는
// 기반 모듈이라, 거기 두면 그 성질이 이 필드 하나 때문에 깨진다.
//
// 왜 `src/themes/` 가 아닌가: 그쪽 모듈들은 오늘 어떤 스토어도 직접 import 하지 않고
// (`src/themes/*.ts` 의 import 문 전수, 2026-09-23), `stores → themes` 방향의 간선은
// 이미 있다(`stores/settings/store.ts` 가 `themes/installed-theme-defs` 를 읽는다).
// 반대 방향을 새로 내는 것보다 이미 있는 방향에 얹는 것이 싸다.
import type { ChromeSurface } from "./ui";

import { useSettingsStore } from "../settings/store";
import { CHROME_SURFACE_FIELD, useUIStore } from "./ui";

/**
 * 이 테마가 크롬을 제안한다면, 사용자가 아직 손대지 않았고 **거절하지도 않은** 표면에 그 값을 쓴다.
 *
 * **제안하지 않는 테마는 아무 표면도 건드리지 않는다.** 그런 테마는 둘이다 —
 * 매니페스트가 아예 없는 것(내장 테마 · `ThemeEditor` 가 만든 커스텀 테마: 설치
 * 기록이 없다)과, 설치됐지만 `chrome` 을 싣지 않은 것. 둘을 가르는 것은 `?.` 하나지만
 * 뜻은 같다.
 *
 * 거절(스펙 0063 §3)은 설정 스토어의 `declinedChromeProposals` 이고 재시작을 넘는다. 이번
 * 세션에 손댄 표면(`chromeTouched`)은 `proposeChromeVisibility` 가 건너뛴다. 거절은 제안을
 * **빼기만** 하므로 저장된 기록이 표면을 숨길 수는 없다.
 *
 * 부르는 쪽은 `hooks/use-settings-effects.ts` 의 전용 이펙트 하나이고, 그 deps 가
 * `[effectiveThemeId]` 뿐인 이유는 거기 주석에 있다.
 */
export function applyThemeChrome(themeId: string): void {
  const { declinedChromeProposals, installedThemes } =
    useSettingsStore.getState();
  const chrome = installedThemes[themeId]?.manifest.chrome;
  if (chrome === undefined) return;
  const declined = declinedChromeProposals[themeId] ?? {};
  const proposal: Partial<Record<ChromeSurface, boolean>> = {};
  for (const [surface, value] of Object.entries(chrome) as [
    ChromeSurface,
    boolean | undefined,
  ][]) {
    if (value !== undefined && declined[surface] !== true) {
      proposal[surface] = value;
    }
  }
  useUIStore.getState().proposeChromeVisibility(proposal);
}

/**
 * 스펙 0063 §3.3 — 사용자가 표면을 직접 고른 뒤에 부른다(`ui.ts` 의 `setUserChromeChoiceListener`).
 *
 * 그 표면의 지금 가시성이 이 테마의 제안과 **다르면** 거절로 기록하고, **같으면** 기록을 지운다.
 * 제안이 없는 테마, 제안에 없는 표면은 기록하지 않는다. `themeId` 는 부르는 쪽이 넘기는 유효
 * 테마다 — `applyThemeChrome` 을 부르는 이펙트와 같은 값이다.
 */
export function recordChromeChoice(
  themeId: string,
  surfaces: readonly ChromeSurface[],
): void {
  const settings = useSettingsStore.getState();
  const chrome = settings.installedThemes[themeId]?.manifest.chrome;
  if (chrome === undefined) return;
  const ui = useUIStore.getState();
  for (const surface of surfaces) {
    const proposed = chrome[surface];
    if (proposed === undefined) continue;
    settings.setChromeProposalDeclined(
      themeId,
      surface,
      ui[CHROME_SURFACE_FIELD[surface]] !== proposed,
    );
  }
}

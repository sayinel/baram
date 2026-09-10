// §338/§341/M-3 — one place that knows "is this feature off, and if so what do we
// tell the user". Two call sites used to each keep their own copy of this: the
// native-menu handler had its own `FEATURE_DISABLED_TOAST_KEY` (ai/journal/
// zettelkasten only — no native menu item routes through `tasks`), and the
// keybinding-actions hook had a private `aiReady()` hardcoded to the one feature
// it happened to need first. Neither would notice a member the other one added,
// and 34 of 39 registered keybindings never went through either copy — see
// `use-keybinding-actions.ts`'s derived completeness test for how that's caught
// now.
import type { FeatureKey } from "../stores/settings/feature-keys";

import { type Locale, t } from "../i18n";
import { isFeatureEnabled } from "../stores/settings/features";
import { useSettingsStore } from "../stores/settings/store";
import { useUIStore } from "../stores/ui/ui";

/**
 * 기능이 꺼졌을 때 보여줄 토스트 i18n 키.
 *
 * ‼️ `Partial`이다 — **`tasks`용 문구가 없다.** §341 당시 tasks는 소유한 네이티브
 * 메뉴 항목이 없어 토스트 문구를 만들 필요가 없었고, 이후로도 만든 적이 없다.
 * `Record<FeatureKey, string>`으로 좁히지 못하는 이유가 이거다 — 다섯 번째
 * `FeatureKey`가 생겨도 tsc는 이 맵의 누락을 잡지 못한다. 그 부재를 잡는 조건부
 * 검사는 `feature-gate.test.ts`의 파생 테스트다: `FeatureKey` 전체에서 여기 이름 붙은
 * 예외(`tasks`, 사유와 함께)를 뺀 나머지가 이 맵의 키 집합과 정확히 같아야 한다 —
 * 다섯 번째 멤버가 예외 없이 추가되면 그 테스트가 실패한다.
 */
export const FEATURE_DISABLED_TOAST_KEY: Partial<Record<FeatureKey, string>> = {
  ai: "space.ai.disabled",
  journal: "space.journal.disabled",
  zettelkasten: "space.zettel.disabled",
};

/**
 * 기능이 켜져 있으면 true. 꺼져 있으면(그리고 토스트 문구가 있으면) 토스트를 띄우고
 * false.
 *
 * ‼️ 문구가 없는 기능(현재 `tasks`)은 조용히 `false`만 돌려준다 — 그 호출부는
 * 스스로 판단해야 한다: 토스트 없이 막는 것이 조용한 무동작(§18.19 결함 A)이 되지
 * 않는지. 지금은 `tasks`로 이 함수를 부르는 호출부가 없다 — 있다면 그 결정과 이유를
 * 호출부 옆에 적을 것.
 */
export function featureReady(feature: FeatureKey): boolean {
  if (isFeatureEnabled(feature)) return true;
  const toastKey = FEATURE_DISABLED_TOAST_KEY[feature];
  if (toastKey) {
    const { locale } = useSettingsStore.getState();
    useUIStore.getState().showToast(t(toastKey, locale as Locale));
  }
  return false;
}

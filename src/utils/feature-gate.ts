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
 * 기능이 꺼졌을 때 보여줄 토스트 i18n 키 — `FeatureKey` 전부.
 *
 * ‼️ 한때 `Partial`이었다: `tasks`용 문구가 없었다(§341 당시 tasks는 소유한 네이티브
 * 메뉴 항목이 없어 만들 필요가 없었고, 이후로도 안 만들었다). 그래서 다섯 번째
 * `FeatureKey`가 생겨도 tsc가 이 맵의 누락을 못 잡았다 — 대신 파생 테스트가
 * `FeatureKey` 전체와 이 맵의 키 집합이 (이름 붙은 예외를 빼고) 같은지 검사했다.
 * `tasks.taskInput`(use-keybinding-actions.ts)이 이 문구를 필요로 하면서
 * `space.tasks.disabled`를 만들었고, `Record`로 좁혔다 — 이제 다섯 번째 멤버는 tsc가
 * **컴파일 시점에** 잡는다. 파생 테스트는 지웠다: 타입이 이미 증명하는 것을 런타임에
 * 다시 확인할 이유가 없다.
 */
export const FEATURE_DISABLED_TOAST_KEY: Record<FeatureKey, string> = {
  ai: "space.ai.disabled",
  journal: "space.journal.disabled",
  tasks: "space.tasks.disabled",
  zettelkasten: "space.zettel.disabled",
};

/**
 * 기능이 켜져 있으면 true. 꺼져 있으면 토스트를 띄우고 false.
 *
 * ‼️ 모든 `FeatureKey`가 `FEATURE_DISABLED_TOAST_KEY`에 문구를 갖는다(위 타입이
 * 보장한다) — 그래서 "문구가 없으면 조용히 막기만 한다"는 분기가 없다. 그 분기가
 * 있던 시절 §18.19 결함 A(조용한 무동작)를 피하려고 tasks 관련 호출부 하나를
 * 예외로 남겨 뒀었는데, 지금은 그 예외 자체가 없다.
 */
export function featureReady(feature: FeatureKey): boolean {
  if (isFeatureEnabled(feature)) return true;
  const { locale } = useSettingsStore.getState();
  useUIStore
    .getState()
    .showToast(t(FEATURE_DISABLED_TOAST_KEY[feature], locale as Locale));
  return false;
}

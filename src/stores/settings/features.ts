// §338 하나의 토글이 그 기능의 모든 진입 표면을 지배한다.
//
// 토글 4개가 두 스토어에 흩어져 있다 — journal/zettelkasten/tasks는 settings 스토어,
// ai는 ai 스토어(별도 persist 키 `baram:ai-settings`). 소비자가 그 분산을 알 필요는
// 없으므로 여기서 하나의 술어로 덮는다.
import type { FeatureKey } from "./feature-keys";

import { useShallow } from "zustand/shallow";

import { useAIStore } from "../ai/ai";
import { useSettingsStore } from "./store";

/**
 * 훅을 쓸 수 없는 자리용 — 슬래시 아이템 빌더, 키바인딩 액션, 스토어 액션.
 *
 * ‼️ `switch`이고 각 `case`가 `return`한다. `FeatureKey`에 멤버가 늘면 tsc가
 * "not all code paths return a value"로 잡는다. `if` 연쇄 + 마지막 fallback으로
 * 바꾸면 새 멤버가 조용히 그 fallback으로 흘러간다.
 */
export function isFeatureEnabled(feature: FeatureKey): boolean {
  switch (feature) {
    case "ai":
      return useAIStore.getState().aiEnabled;
    case "journal":
      return useSettingsStore.getState().journalEnabled;
    case "tasks":
      return useSettingsStore.getState().tasksEnabled;
    case "zettelkasten":
      return useSettingsStore.getState().zettelkastenEnabled;
  }
}

/**
 * 컴포넌트용. 네 값을 한 번에 구독한다 — 표면 대부분이 둘 이상을 본다.
 *
 * ‼️ 매 렌더마다 새 객체를 돌려주므로 **즉시 구조분해**할 것. 반환값 자체를
 * `useMemo`/`useEffect` deps에 넣으면 매 렌더 재실행된다.
 */
export function useFeatureFlags(): Record<FeatureKey, boolean> {
  const { journal, tasks, zettelkasten } = useSettingsStore(
    useShallow((s) => ({
      journal: s.journalEnabled,
      tasks: s.tasksEnabled,
      zettelkasten: s.zettelkastenEnabled,
    })),
  );
  const ai = useAIStore((s) => s.aiEnabled);
  return { ai, journal, tasks, zettelkasten };
}

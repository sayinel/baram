import { beforeEach, describe, expect, it } from "vitest";

import { t } from "../../i18n";
import { useAIStore } from "../../stores/ai/ai";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { FEATURE_DISABLED_TOAST_KEY, featureReady } from "../feature-gate";

// ‼️ FEATURE_DISABLED_TOAST_KEY used to be Partial<Record<FeatureKey, string>>
// — no `space.tasks.disabled` copy existed — and a derived test here checked
// that every FeatureKey without a toast key was named, with a reason, in an
// exception list (fix-d-brief.md's "조건부 검사" in place of a type-level
// guarantee). Once `tasks.taskInput` needed the copy (use-keybinding-actions.ts)
// and it was created, the map narrowed to Record<FeatureKey, string> — tsc now
// catches a 5th FeatureKey missing an entry at compile time, so that runtime
// check would be re-proving what the type already guarantees. Deleted rather
// than kept as dead weight.

function enableAll() {
  useAIStore.setState({ aiEnabled: true });
  useSettingsStore.setState({
    journalEnabled: true,
    tasksEnabled: true,
    zettelkastenEnabled: true,
    locale: "en",
  });
}

beforeEach(() => {
  enableAll();
  useUIStore.setState({ toast: null });
});

describe("featureReady", () => {
  it("returns true and does not toast when the feature is on", () => {
    expect(featureReady("ai")).toBe(true);
    expect(useUIStore.getState().toast).toBeNull();
  });

  it.each(["ai", "journal", "tasks", "zettelkasten"] as const)(
    "returns false and toasts the catalogue message for %s when off",
    (feature) => {
      useAIStore.setState({ aiEnabled: feature !== "ai" });
      useSettingsStore.setState({
        journalEnabled: feature !== "journal",
        tasksEnabled: feature !== "tasks",
        zettelkastenEnabled: feature !== "zettelkasten",
      });

      expect(featureReady(feature)).toBe(false);
      // ‼️ 이 단정은 `t(키)` 를 양쪽에서 쓴다 — `featureReady` 안쪽도 같은 `t(같은 키)` 다.
      // 예전 주석은 "카탈로그 TEXT 와 비교하므로 t-vs-t 를 피했다"고 적혀 있었는데
      // **거짓이었다**: 실측으로 `space.tasks.disabled` 를 en·ko 양쪽에서 지웠더니 이 파일
      // 23건과 `src/i18n/__tests__/` 79건이 전부 초록이었고(locale-parity 는 양쪽에서
      // 없어진 키를 못 잡는다) 사용자는 토스트에 **원시 키**를 보게 된다.
      //
      // 그래서 아래 한 줄이 그 구멍을 메운다: `t` 는 키가 없으면 키 자체를 돌려주므로,
      // "번역된 값이 키와 다르다"가 곧 카탈로그에 그 항목이 있다는 증거다. 이 형태를
      // 쓰는 새 테스트가 네 곳 이상이고, 이 한 줄이 그 부류를 함께 지킨다.
      const key = FEATURE_DISABLED_TOAST_KEY[feature];
      expect(t(key, "en")).not.toBe(key);
      expect(useUIStore.getState().toast?.message).toBe(t(key, "en"));
    },
  );
});

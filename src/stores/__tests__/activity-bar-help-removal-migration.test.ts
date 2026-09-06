// §4.2 v22 → v23: 인앱 Help 패널이 사라졌으므로 영속된 활동표시줄 설정에서
// 'help' 항목을 걷어낸다.
//
// ‼️ 이 항목을 남겨두면 ActivityBar는 아이콘이 없어 조용히 거르지만(:211-212)
// ActivityBarTab은 영속 배열을 그대로 렌더해(:27-28) "켜도 아무 일도 없는" 행이
// 남고, i18n 키까지 지웠으므로 라벨 자리에 키 문자열이 그대로 뜬다.
//
// 진짜 migrate 함수를 통과시킨다 — 로직 사본을 검사하면 마이그레이션을 지워도 통과한다.
import type { ActivityBarItemConfig } from "../settings/store";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ACTIVITY_BAR_CONFIG,
  useSettingsStore,
} from "../settings/store";

/** v22 시절의 영속 배열 — 기본값에 'help'가 아직 들어 있던 모양. */
function configWithHelp(): ActivityBarItemConfig[] {
  return [
    ...DEFAULT_ACTIVITY_BAR_CONFIG.map((item) => ({ ...item })),
    { id: "help", visible: true, section: "bottom" as const },
  ];
}

function migrate(persisted: unknown, version: number): ActivityBarItemConfig[] {
  const { migrate } = useSettingsStore.persist.getOptions();
  if (typeof migrate !== "function") {
    throw new Error("persist migrate is not configured");
  }
  const result = migrate(persisted, version) as {
    activityBarConfig: ActivityBarItemConfig[];
  };
  return result.activityBarConfig;
}

describe("settings store v22 -> v23 (activity bar: drop 'help')", () => {
  it("removes the help item from a persisted config", () => {
    const ids = migrate({ activityBarConfig: configWithHelp() }, 22).map(
      (c) => c.id,
    );

    expect(ids).not.toContain("help");
  });

  it("keeps every other item, including user ordering", () => {
    const persisted = configWithHelp();
    // 사용자가 순서를 바꾼 상태를 흉내낸다 — 마이그레이션이 순서를 되돌리면 안 된다.
    persisted.reverse();

    const ids = migrate({ activityBarConfig: persisted }, 22).map((c) => c.id);
    const expected = persisted.map((c) => c.id).filter((id) => id !== "help");

    expect(ids).toEqual(expected);
  });

  it("preserves a hidden item's visible flag", () => {
    const persisted = configWithHelp().map((c) =>
      c.id === "chat" ? { ...c, visible: false } : c,
    );

    const result = migrate({ activityBarConfig: persisted }, 22);

    expect(result.find((c) => c.id === "chat")?.visible).toBe(false);
  });

  it("is a no-op for a config that never had help", () => {
    const persisted = DEFAULT_ACTIVITY_BAR_CONFIG.map((item) => ({ ...item }));

    const ids = migrate({ activityBarConfig: persisted }, 22).map((c) => c.id);

    expect(ids).toEqual(DEFAULT_ACTIVITY_BAR_CONFIG.map((c) => c.id));
  });

  it("survives a missing activityBarConfig", () => {
    const { migrate: fn } = useSettingsStore.persist.getOptions();
    if (typeof fn !== "function") throw new Error("no migrate");

    expect(() => fn({}, 22)).not.toThrow();
  });
});

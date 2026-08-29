// M2-b4 v20 → v21 — `journal.captureTaskMode`가 `tasks.taskInput`이 됐다.
//
// `keybindingOverrides`는 **명령 id로 키잉된다.** 이름을 바꾸면서 옮겨 주지 않으면 그
// 키를 이미 자기 조합으로 바꿔 둔 사용자의 값이 조용히 사라지고 기본값으로 돌아간다 —
// 사용자는 "어느 날부터 내가 고른 키가 안 먹는다"로 겪는다. 그 사이 아무것도 실패하지
// 않으므로 이 테스트가 유일한 감시자다.
import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

type Overrides = Record<string, string> | undefined;

function migrateFrom(
  state: Record<string, unknown>,
  version: number,
): { keybindingOverrides?: Record<string, string> } {
  const migrate = useSettingsStore.persist.getOptions().migrate;
  expect(migrate).toBeDefined();
  return migrate!(state, version) as {
    keybindingOverrides?: Record<string, string>;
  };
}

describe("settings store taskInput keybinding migration (v21)", () => {
  it("옛 id에 걸린 사용자 조합을 새 id로 옮긴다", () => {
    const out = migrateFrom(
      { keybindingOverrides: { "journal.captureTaskMode": "Mod+Alt+K" } },
      20,
    );
    expect(out.keybindingOverrides?.["tasks.taskInput"]).toBe("Mod+Alt+K");
  });

  it("옮긴 뒤 옛 id는 남기지 않는다", () => {
    // 남겨 두면 설정의 키빈딩 목록이 레지스트리에 없는 항목을 들고 있게 되고,
    // 다음 이름 변경 때 무엇이 살아 있는 값인지 알 수 없다.
    const out = migrateFrom(
      { keybindingOverrides: { "journal.captureTaskMode": "Mod+Alt+K" } },
      20,
    );
    expect(out.keybindingOverrides).not.toHaveProperty(
      "journal.captureTaskMode",
    );
  });

  it("새 id에 이미 값이 있으면 그쪽을 이긴 것으로 둔다", () => {
    // 사용자가 새 이름으로 직접 고른 값이다. 옛 이름이 덮어쓰면 방금 한 선택이 사라진다.
    const out = migrateFrom(
      {
        keybindingOverrides: {
          "journal.captureTaskMode": "Mod+Alt+K",
          "tasks.taskInput": "Mod+Alt+J",
        },
      },
      20,
    );
    expect(out.keybindingOverrides?.["tasks.taskInput"]).toBe("Mod+Alt+J");
  });

  it("바꿔 둔 적이 없으면 아무것도 만들지 않는다", () => {
    // 기본값을 쓰는 사용자에게 override를 심으면, 나중에 기본값을 바꿔도 그 사용자에게는
    // 닿지 않는다 — 마이그레이션이 사용자의 선택을 발명한 셈이 된다.
    const out = migrateFrom({ keybindingOverrides: {} }, 20);
    expect(out.keybindingOverrides).toEqual({});
  });

  it("override가 아예 없어도 터지지 않는다", () => {
    expect(() => migrateFrom({}, 20)).not.toThrow();
  });

  it("이미 v21이면 손대지 않는다", () => {
    const out = migrateFrom(
      { keybindingOverrides: { "journal.captureTaskMode": "Mod+Alt+K" } },
      21,
    );
    const overrides: Overrides = out.keybindingOverrides;
    expect(overrides?.["journal.captureTaskMode"]).toBe("Mod+Alt+K");
    expect(overrides?.["tasks.taskInput"]).toBeUndefined();
  });
});

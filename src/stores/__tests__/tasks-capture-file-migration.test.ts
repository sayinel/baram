// §312.1 v19 → v20 — `tasksCaptureFile`이 태스크 홈 기준 경로에서
// `{tasksHome}/tasks/` **안의 이름**으로 바뀌었다.
//
// 이 마이그레이션이 있는 이유는 §312.1이 "기존 사용자 없음, 백필 불필요"라고 적었다가
// 하루 만에 뒤집혔기 때문이다: persist는 저장된 `"Inbox.md"`를 되살리므로 새 기본값이
// 이미 앱을 켜 본 사람에게는 영영 닿지 않고, 이 슬라이스가 만들려던 `tasks/` 서브트리가
// 빈 채로 남는다.
import { describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

function migrateFrom(
  state: Record<string, unknown>,
  version: number,
): { tasksCaptureFile?: string } {
  const migrate = useSettingsStore.persist.getOptions().migrate;
  expect(migrate).toBeDefined();
  return migrate!(state, version) as { tasksCaptureFile?: string };
}

describe("settings store tasksCaptureFile migration (§312.1, v20)", () => {
  it("§312.1 이전의 기본값을 이름만 남긴 값으로 옮긴다", () => {
    expect(
      migrateFrom({ tasksCaptureFile: "Inbox.md" }, 19).tasksCaptureFile,
    ).toBe("inbox.md");
  });

  it("§312.1이 하루 동안 쓰던 중간 기본값도 함께 옮긴다", () => {
    // `tasks/inbox.md`는 서브트리 결정 직후의 모양이다. 그대로 두면
    // `{home}/tasks/tasks/inbox.md`가 되어 수집함이 한 겹 더 들어간다.
    expect(
      migrateFrom({ tasksCaptureFile: "tasks/inbox.md" }, 19).tasksCaptureFile,
    ).toBe("inbox.md");
  });

  it("사용자가 직접 정한 값은 건드리지 않는다", () => {
    // 기본값을 되살리는 것과 사용자의 선택을 덮어쓰는 것은 다른 일이다.
    expect(
      migrateFrom({ tasksCaptureFile: "work.md" }, 19).tasksCaptureFile,
    ).toBe("work.md");
  });

  it("이미 v20이면 아무것도 하지 않는다", () => {
    expect(
      migrateFrom({ tasksCaptureFile: "Inbox.md" }, 20).tasksCaptureFile,
    ).toBe("Inbox.md");
  });

  it("아주 오래된 버전에서 올라와도 같은 결과다", () => {
    expect(
      migrateFrom({ tasksCaptureFile: "Inbox.md", theme: "dark" }, 1)
        .tasksCaptureFile,
    ).toBe("inbox.md");
  });

  it("partialize 화이트리스트에 있다 — 없으면 다음 저장에 조용히 사라진다", () => {
    // 마이그레이션이 옳아도 partialize가 그 키를 빠뜨리면 다음 쓰기에서 값이 날아가고,
    // 마이그레이션 테스트는 전부 초록인 채로 매 실행마다 기본값으로 되돌아간다.
    const partialize = useSettingsStore.persist.getOptions().partialize;
    expect(partialize).toBeDefined();
    const out = partialize!({
      ...useSettingsStore.getState(),
      tasksCaptureFile: "work.md",
      tasksHome: "/home",
      tasksScanScope: "tasksHome",
    }) as Record<string, unknown>;
    expect(out.tasksCaptureFile).toBe("work.md");
    expect(out.tasksHome).toBe("/home");
    expect(out.tasksScanScope).toBe("tasksHome");
  });
});

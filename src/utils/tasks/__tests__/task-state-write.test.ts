// §318/§18.18 한 상태 전이가 줄에 무엇을 하는가 — 두 진입점이 함께 보는 규칙.
//
// 이 파일이 지키는 것은 "굴린다"가 아니라 **굴릴 때 함께 일어나야 하는 것들**이다.
// 상태·스탬프·시계·날짜 넷 중 하나만 어긋나도 그 줄은 자기가 몇 회차이고 끝났는지에
// 대해 서로 다른 말을 하게 된다.
import { describe, expect, it } from "vitest";

import { resolveStateWrite } from "../task-state-write";

const NOW = new Date(2026, 8, 5, 14, 3);
const RECURRING = "주간 회고 📅2026-09-01 🔁every week";
const PLAIN = "초안 📅2026-09-01";

const OFF = { now: NOW, recordDoneDate: true, trackTime: false };

describe("§318 굴리는 전이", () => {
  it("완료를 요청해도 줄에 쓰는 것은 `todo`다 — 다음 회차는 아직 하지 않은 일이다", () => {
    const write = resolveStateWrite("done", RECURRING, OFF);

    expect(write.newState).toBe("todo");
    expect(write.dates).toEqual({ due: "2026-09-08" });
    expect(write.roll?.next).toBe("2026-09-08");
  });

  it("취소도 굴린다 — 이번 회차를 건너뛰는 것이지 반복을 끝내는 것이 아니다", () => {
    expect(resolveStateWrite("cancelled", RECURRING, OFF).newState).toBe("todo");
  });

  // ‼️ 이것이 이 파일에서 가장 중요한 단정이다. `recordDoneDate`가 거짓이면 Rust
  // `apply_state`가 일찍 돌아가 기존 ✅/❌를 떼지 못한다 — `[ ]`인데 완료일이 붙은,
  // 자기가 끝났는지에 대해 두 가지를 말하는 줄이 남는다. 굴리기는 그 설정과 무관하게
  // 참을 올려 보내고, `Todo.stamp_field()`가 `None`이라 새 스탬프는 찍히지 않는다.
  it("사용자 설정과 무관하게 종료 스탬프를 떼도록 요청한다", () => {
    const write = resolveStateWrite("done", RECURRING, {
      ...OFF,
      recordDoneDate: false,
    });

    expect(write.recordDoneDate).toBe(true);
  });

  it("굴리지 않는 전이는 사용자 설정을 그대로 따른다", () => {
    expect(
      resolveStateWrite("done", PLAIN, { ...OFF, recordDoneDate: false })
        .recordDoneDate,
    ).toBe(false);
  });
});

describe("§318 굴리지 않는 경우", () => {
  it.each([
    ["반복 규칙이 없다", PLAIN],
    ["규칙을 못 읽는다", "초안 📅2026-09-01 🔁every fortnight"],
    ["밀 날짜가 없다", "물 주기 🔁every 3 days"],
  ])("%s → 요청한 상태를 그대로 쓴다", (_label, line) => {
    const write = resolveStateWrite("done", line, OFF);

    expect(write.newState).toBe("done");
    expect(write.roll).toBeNull();
    expect(write.dates).toBeUndefined();
  });

  it.each(["todo", "doing"] as const)("%s로 가는 전이는 굴리지 않는다", (to) => {
    expect(resolveStateWrite(to, RECURRING, OFF).roll).toBeNull();
  });
});

describe("§318 굴릴 때의 시계", () => {
  const ON = { now: NOW, recordDoneDate: true, trackTime: true };

  it("새 회차는 0에서 시작한다", () => {
    expect(
      resolveStateWrite("done", "주간 회고 📅2026-09-01 ⏱2h 🔁every week", ON)
        .timer,
    ).toBe("0m");
  });

  it("돌고 있던 시계도 0이다 — 그 시간은 지난 회차의 것이다", () => {
    expect(
      resolveStateWrite(
        "done",
        "주간 회고 📅2026-09-01 ⏱1h+2026-09-05T13:03 🔁every week",
        ON,
      ).timer,
    ).toBe("0m");
  });

  // ‼️ 없던 필드를 만들지 않는다. "굴리기는 사용자가 이미 적은 것만 바꾼다"가 §318이
  // 설정 없이 기본 켜짐일 수 있는 근거이고, 여기서 필드를 새로 만들면 그 근거가 깨진다.
  it("시계가 없던 줄에는 시계를 만들지 않는다", () => {
    expect(resolveStateWrite("done", RECURRING, ON).timer).toBeNull();
  });

  it("시간 기록이 꺼져 있으면 손대지 않는다", () => {
    expect(
      resolveStateWrite("done", "주간 회고 📅2026-09-01 ⏱2h 🔁every week", OFF)
        .timer,
    ).toBeNull();
  });

  // 굴리지 않는 전이는 M4 그대로다 — `doing`에 들어가면 시계가 돌기 시작한다.
  it("굴리지 않는 전이의 시계 규칙은 M4에서 바뀌지 않았다", () => {
    expect(resolveStateWrite("doing", "초안 ⏱30m", ON).timer).toBe(
      "30m+2026-09-05T14:03",
    );
  });
});

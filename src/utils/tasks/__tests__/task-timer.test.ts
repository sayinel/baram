// §18.18 M4 — `⏱` 값 문법과 상태 연동.
//
// 이 필드는 다른 §303 필드와 두 가지가 다르다: 값이 **두 사실**을 나르고(누적 + 진행
// 중인지), 그 값이 **시간이 지나면 뜻이 달라진다**. 그래서 여기서 못박는 것은 대부분
// "잃지 않는가"이다 — 누적은 덮이지 않는가, 다시 시작해도 남는가, 읽지 못하는 값을
// 우리가 지우지는 않는가.
import { describe, expect, it } from "vitest";

import {
  elapsedMinutes,
  formatTimer,
  parseTimer,
  stampOf,
  timerForState,
} from "../task-timer";

const AT = (h: number, m: number) => new Date(2026, 7, 31, h, m);

describe("parseTimer / formatTimer", () => {
  it.each([
    ["0m", 0, null],
    ["45m", 45, null],
    ["2h", 120, null],
    ["1h27m", 87, null],
    ["1h27m+2026-08-31T14:03", 87, "2026-08-31T14:03"],
    ["0m+2026-08-31T14:03", 0, "2026-08-31T14:03"],
  ])("reads %s", (value, minutes, startedAt) => {
    expect(parseTimer(value)).toEqual({
      accumulatedMinutes: minutes,
      startedAt,
    });
  });

  // 왕복이 정확해야 값이 저장을 견딘다 — 한쪽만 맞으면 파일이 매번 조금씩 달라진다.
  it.each(["0m", "45m", "2h", "1h27m", "1h27m+2026-08-31T14:03"])(
    "round-trips %s",
    (value) => {
      expect(formatTimer(parseTimer(value)!)).toBe(value);
    },
  );

  // ‼️ 읽지 못하는 값은 **우리 것이 아니다**. 0으로 읽어 버리면 다른 도구가 적은
  // `⏱30분`을 우리가 `0m`으로 덮어쓴다.
  it.each([
    ["a bare emoji value", ""],
    ["a foreign unit", "30분"],
    ["a plain number", "90"],
    ["seconds", "1h27m30s"],
    ["a calendar-impossible stamp", "1h@2026-02-31T14:03"],
    ["an impossible clock", "1h@2026-08-31T25:00"],
  ])("refuses %s", (_label, value) => {
    expect(parseTimer(value)).toBeNull();
  });
});

describe("elapsedMinutes", () => {
  it("adds the running stretch to what was already banked", () => {
    const timer = parseTimer("1h27m+2026-08-31T14:03")!;
    expect(elapsedMinutes(timer, AT(15, 3))).toBe(87 + 60);
  });

  it("is just the accumulation when nothing is running", () => {
    expect(elapsedMinutes(parseTimer("1h27m")!, AT(23, 0))).toBe(87);
  });

  // 파일은 다른 기계에서, 다른 시계로 쓰인다. 뒤로 간 시각이 누적을 **깎으면** 기록이
  // 조용히 줄어든다 — 늘지 않는 것이 줄어드는 것보다 낫다.
  it("never subtracts when the clock went backwards", () => {
    const timer = parseTimer("1h27m+2026-08-31T14:03")!;
    expect(elapsedMinutes(timer, AT(13, 0))).toBe(87);
  });
});

describe("timerForState", () => {
  it("starts the clock on entering `doing`", () => {
    expect(timerForState("0m", "doing", AT(14, 3))).toBe("0m+2026-08-31T14:03");
  });

  // ‼️ 이 테스트가 이 설계를 고른 이유 자체다. 시작 시각이 누적을 덮는 형식이었다면
  // 여기서 1h27m이 사라진다.
  it("keeps what was already banked when it restarts", () => {
    expect(timerForState("1h27m", "doing", AT(14, 3))).toBe(
      "1h27m+2026-08-31T14:03",
    );
  });

  // 두 번째 시작 도장을 찍으면 그 사이의 시간이 누적에 들어가지 못한 채 사라진다.
  it("does not re-stamp a clock that is already running", () => {
    const running = "1h27m+2026-08-31T14:03";
    expect(timerForState(running, "doing", AT(15, 30))).toBe(running);
  });

  it.each(["todo", "done", "cancelled"] as const)(
    "banks the running stretch on leaving for `%s`",
    (state) => {
      expect(timerForState("1h27m+2026-08-31T14:03", state, AT(15, 3))).toBe(
        "2h27m",
      );
    },
  );

  it("leaves a stopped clock alone", () => {
    expect(timerForState("1h27m", "done", AT(15, 3))).toBe("1h27m");
  });

  // ‼️ 전이가 아니라 **도달한 상태**를 본다. 손으로 `[/]`를 `[x]`로 고쳐 놓아 타이머만
  // 돌고 있는 줄은, 다음 조작에서 저절로 멈춘다. 전이(from→to)로 썼다면 그 줄은
  // 영원히 돌고 누적은 영원히 늘어난다.
  it("stops a clock left running on a state that should not have one", () => {
    expect(timerForState("0m+2026-08-31T14:03", "done", AT(14, 33))).toBe(
      "30m",
    );
  });

  it("leaves a value it cannot read untouched", () => {
    expect(timerForState("30분", "doing", AT(14, 3))).toBe("30분");
  });
});

describe("stampOf", () => {
  it("writes local time to the minute", () => {
    expect(stampOf(new Date(2026, 0, 5, 9, 7))).toBe("2026-01-05T09:07");
  });
});

// §318 반복 회차 굴리기 — 규칙 문법과 다음 날짜 계산.
//
// 이 스위트가 지키는 성질 셋:
//   1. 못 읽는 규칙은 `null`이다 (추측해서 남의 파일을 고치지 않는다).
//   2. 달력 경계에서 실재하지 않는 날짜를 만들지 않는다 (2/30, 2/29 평년).
//   3. 굴린 날짜들은 **상대 간격을 보존한다** — 시작·예정·기한이 같은 delta로 움직인다.
import { describe, expect, it } from "vitest";

import {
  nextDate,
  parseRecurrence,
  rollForState,
} from "../task-recurrence";

describe("§318 parseRecurrence", () => {
  it.each([
    ["every day", { dayOfMonth: null, interval: 1, unit: "day", weekday: null }],
    [
      "every 3 days",
      { dayOfMonth: null, interval: 3, unit: "day", weekday: null },
    ],
    [
      "every week",
      { dayOfMonth: null, interval: 1, unit: "week", weekday: null },
    ],
    [
      "every 2 weeks",
      { dayOfMonth: null, interval: 2, unit: "week", weekday: null },
    ],
    [
      "every month",
      { dayOfMonth: null, interval: 1, unit: "month", weekday: null },
    ],
    [
      "every year",
      { dayOfMonth: null, interval: 1, unit: "year", weekday: null },
    ],
    [
      "every weekday",
      { dayOfMonth: null, interval: 1, unit: "weekday", weekday: null },
    ],
    [
      "every week on Monday",
      { dayOfMonth: null, interval: 1, unit: "week", weekday: 1 },
    ],
    [
      "every 2 weeks on friday",
      { dayOfMonth: null, interval: 2, unit: "week", weekday: 5 },
    ],
    [
      "every month on the 3rd",
      { dayOfMonth: 3, interval: 1, unit: "month", weekday: null },
    ],
    [
      "every month on the 31st",
      { dayOfMonth: 31, interval: 1, unit: "month", weekday: null },
    ],
  ])("reads %s", (rule, expected) => {
    expect(parseRecurrence(rule)).toEqual(expected);
  });

  // 대소문자와 여분 공백은 값의 일부가 아니다 — 손으로 적는 필드라 둘 다 흔하다.
  it.each(["EVERY WEEK", "  every   week  ", "Every Week"])(
    "is indifferent to case and spacing in %s",
    (rule) => {
      expect(parseRecurrence(rule)?.unit).toBe("week");
    },
  );

  // ‼️ 이 스위트의 핵심. 모르는 모양을 그럴듯한 것으로 **읽어 내면** 그 순간
  // 남의 도구가 적은 줄을 우리가 고쳐 쓴다. `parseTimer`가 `⏱30분`을 `0m`으로
  // 읽지 않는 것과 같은 규칙이다.
  it.each([
    ["", "빈 값"],
    ["every fortnight", "모르는 단위"],
    ["매주", "한국어 — 저장 문법은 영어 하나다"],
    ["weekly", "다른 어휘"],
    ["every 0 days", "0 간격 — 굴려도 제자리다"],
    ["every -1 days", "음수 간격"],
    ["every week on Blursday", "없는 요일"],
    ["every month on the 32nd", "없는 날짜"],
    ["every month on the 0th", "0일"],
    ["every 2 weekdays", "평일에는 간격을 두지 않는다"],
    ["every week on the 3rd", "요일 앵커는 주에, 날짜 앵커는 달에만"],
    ["every month on Monday", "같은 이유"],
    ["every day extra", "뒤에 남는 말"],
  ])("refuses %s (%s)", (rule) => {
    expect(parseRecurrence(rule)).toBeNull();
  });
});

describe("§318 nextDate", () => {
  function next(rule: string, from: string): null | string {
    const parsed = parseRecurrence(rule);
    return parsed ? nextDate(parsed, from) : null;
  }

  it.each([
    ["every day", "2026-09-01", "2026-09-02"],
    ["every 3 days", "2026-09-01", "2026-09-04"],
    ["every week", "2026-09-01", "2026-09-08"],
    ["every 2 weeks", "2026-09-01", "2026-09-15"],
    ["every month", "2026-09-01", "2026-10-01"],
    ["every year", "2026-09-01", "2027-09-01"],
  ])("%s from %s → %s", (rule, from, expected) => {
    expect(next(rule, from)).toBe(expected);
  });

  // 월말. `every month`는 출발일의 일자를 유지하려 하고, 그 달에 없으면 마지막 날로
  // 접는다. 접힌 뒤에는 되돌아가지 않는다 — 그것이 설계가 받아들인 drift다.
  it("clamps a month-end to the last day that exists", () => {
    expect(next("every month", "2026-01-31")).toBe("2026-02-28");
  });

  it("does not climb back after clamping — this is the documented drift", () => {
    expect(next("every month", "2026-02-28")).toBe("2026-03-28");
  });

  // drift가 싫은 사람의 탈출구. 앵커가 명시되어 있으면 접힌 자리에서 스스로 회복한다.
  it("recovers from a clamp when the day is anchored explicitly", () => {
    expect(next("every month on the 31st", "2026-02-28")).toBe("2026-03-31");
  });

  it("clamps an anchored day that the target month lacks", () => {
    expect(next("every month on the 31st", "2026-01-31")).toBe("2026-02-28");
  });

  // 윤년. 2028은 윤년, 2027은 아니다.
  it("clamps Feb 29 into a common year", () => {
    expect(next("every year", "2028-02-29")).toBe("2029-02-28");
  });

  it("keeps Feb 29 when the target year has one", () => {
    expect(next("every 4 years", "2028-02-29")).toBe("2032-02-29");
  });

  // 요일 고정. 2026-09-01은 화요일이다.
  it("advances to the next matching weekday", () => {
    expect(next("every week on monday", "2026-09-01")).toBe("2026-09-07");
  });

  // 이미 그 요일이면 **다음** 그 요일이다 — 제자리에 서면 굴린 것이 아니다.
  it("moves off a date that already matches", () => {
    expect(next("every week on monday", "2026-09-07")).toBe("2026-09-14");
  });

  it("adds the extra weeks after landing on the weekday", () => {
    expect(next("every 2 weeks on monday", "2026-09-01")).toBe("2026-09-14");
  });

  // 평일. 2026-09-04는 금요일 → 월요일로 건너뛴다.
  it("jumps a weekend", () => {
    expect(next("every weekday", "2026-09-04")).toBe("2026-09-07");
  });

  it("steps one day inside the week", () => {
    expect(next("every weekday", "2026-09-01")).toBe("2026-09-02");
  });

  // 토·일에 적힌 기한도 다음 평일로 나간다.
  it.each([
    ["2026-09-05", "2026-09-07"],
    ["2026-09-06", "2026-09-07"],
  ])("moves %s off the weekend to %s", (from, expected) => {
    expect(next("every weekday", from)).toBe(expected);
  });

  it("refuses a date that is not on the calendar", () => {
    const parsed = parseRecurrence("every day");
    expect(parsed && nextDate(parsed, "2026-02-30")).toBeNull();
  });

  // ‼️ 굴리기는 **항상 앞으로** 간다. 이 성질이 깨지면 완료할 때마다 같은 날짜가
  // 다시 나오거나 과거로 가서 무한히 기한 초과로 뜬다.
  it.each([
    "every day",
    "every 3 days",
    "every week",
    "every 2 weeks on monday",
    "every weekday",
    "every month",
    "every month on the 3rd",
    "every month on the 31st",
    "every year",
  ])("always moves forward: %s", (rule) => {
    for (const from of ["2026-01-31", "2026-02-28", "2026-09-04", "2028-02-29"]) {
      const out = next(rule, from);
      expect(out).not.toBeNull();
      expect(out! > from).toBe(true);
    }
  });
});

describe("§318 rollForState", () => {
  const LINE = "주간 회고 🔁every week 🛫2026-08-30 ⏳2026-08-31 📅2026-09-01";

  it("rolls every date field by the same delta", () => {
    expect(rollForState("done", LINE)).toEqual({
      dates: {
        due: "2026-09-08",
        scheduled: "2026-09-07",
        start: "2026-09-06",
      },
      next: "2026-09-08",
    });
  });

  // 취소는 "이번 회차를 건너뛴다"이지 "반복을 끝낸다"가 아니다 (설계 결정).
  it("rolls on cancel too", () => {
    expect(rollForState("cancelled", LINE)?.next).toBe("2026-09-08");
  });

  it.each(["todo", "doing"] as const)("does not roll on %s", (state) => {
    expect(rollForState(state, LINE)).toBeNull();
  });

  // 기준일 우선순위: 📅 > ⏳ > 🛫. 있는 것 하나가 delta를 정하고 나머지는 따라간다.
  it("anchors on the due date when several are present", () => {
    // 기한 9/1 기준 +7 → 시작도 정확히 +7.
    expect(rollForState("done", LINE)?.dates.start).toBe("2026-09-06");
  });

  it("falls back to scheduled when there is no due date", () => {
    expect(
      rollForState("done", "a 🔁every week 🛫2026-08-30 ⏳2026-08-31"),
    ).toEqual({
      dates: { scheduled: "2026-09-07", start: "2026-09-06" },
      next: "2026-09-07",
    });
  });

  it("falls back to start when it is the only date", () => {
    expect(rollForState("done", "a 🔁every week 🛫2026-08-30")).toEqual({
      dates: { start: "2026-09-06" },
      next: "2026-09-06",
    });
  });

  // ➕ 생성일은 일정이 아니라 기록이다 — 굴려도 그 자리에 남는다.
  it("never moves the created date", () => {
    const roll = rollForState(
      "done",
      "a 🔁every week ➕2026-08-01 📅2026-09-01",
    );
    expect(roll?.dates).toEqual({ due: "2026-09-08" });
  });

  // 굴리지 않는 두 경우. 둘 다 조용한 무동작이라 칩이 따로 말해 준다(§318).
  it("does not roll a line with no date to move", () => {
    expect(rollForState("done", "물 주기 🔁every 3 days")).toBeNull();
  });

  it("does not roll a rule it cannot read", () => {
    expect(rollForState("done", "a 🔁every fortnight 📅2026-09-01")).toBeNull();
  });

  it("does not roll a line with no recurrence at all", () => {
    expect(rollForState("done", "a 📅2026-09-01")).toBeNull();
  });

  // ‼️ 기준일은 **원래 날짜**다(설계 결정). 아무리 늦게 완료해도 일정이 밀리지 않는다.
  // 굴린 결과를 다시 굴리면 원래 일정 위를 그대로 걸어간다 — 완료일이 기준이었다면
  // 이 수열은 완료가 늦어질수록 벌어졌을 것이다.
  it("walks the original schedule, however late each completion is", () => {
    let line = "a 🔁every week 📅2026-09-01";
    const walked: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const roll = rollForState("done", line);
      expect(roll).not.toBeNull();
      walked.push(roll!.next);
      line = `a 🔁every week 📅${roll!.next}`;
    }
    expect(walked).toEqual(["2026-09-08", "2026-09-15", "2026-09-22"]);
  });
});

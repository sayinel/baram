// §308 M3-c 태스크 줄에 적은 말에서 날짜를 알아본다.
import { describe, expect, it } from "vitest";

import { guessTrailingDate } from "../natural-date";

/** 수요일. 요일 계산을 사람이 검산할 수 있게 고정한다. */
const WED = new Date(2026, 8, 16);

/** 커서가 줄 끝에 있다고 보고 묻는다 — 실제 사용에서 가장 흔한 자리다. */
function atEnd(text: string, today = WED) {
  return guessTrailingDate(text, text.length, today);
}

describe("상대 표현", () => {
  it.each([
    ["오늘", "2026-09-16"],
    ["내일", "2026-09-17"],
    ["모레", "2026-09-18"],
    ["어제", "2026-09-15"],
    ["today", "2026-09-16"],
    ["Tomorrow", "2026-09-17"],
    ["yesterday", "2026-09-15"],
    ["3일 후", "2026-09-19"],
    ["10일뒤", "2026-09-26"],
    ["in 3 days", "2026-09-19"],
    ["in 1 day", "2026-09-17"],
  ])("`보고서 %s` → %s", (phrase, iso) => {
    expect(atEnd(`보고서 ${phrase}`)?.iso).toBe(iso);
  });
});

describe("요일", () => {
  it.each([
    // 오늘이 수요일이다.
    ["수요일", "2026-09-16"],
    ["금요일", "2026-09-18"],
    ["월요일", "2026-09-21"],
    ["다음 주 수요일", "2026-09-23"],
    ["다음주 금요일", "2026-09-25"],
    ["friday", "2026-09-18"],
    ["next Friday", "2026-09-25"],
  ])("`회의 %s` → %s", (phrase, iso) => {
    expect(atEnd(`회의 ${phrase}`)?.iso).toBe(iso);
  });

  it("‼️ 오늘과 같은 요일은 오늘이다 — 지난 날을 주지 않는다", () => {
    // 언제나 '다음 것'으로 읽으면 수요일에 `수요일`이라 적은 사람이 이레 뒤를 받는다.
    expect(atEnd("회의 수요일")?.iso).toBe("2026-09-16");
  });
});

describe("절대 날짜 — `resolveDateInput`의 어휘 그대로", () => {
  it.each([
    ["2026-12-25", "2026-12-25"],
    ["9/30", "2026-09-30"],
    ["9월 30일", "2026-09-30"],
    ["9월30일", "2026-09-30"],
  ])("`마감 %s` → %s", (phrase, iso) => {
    expect(atEnd(`마감 ${phrase}`)?.iso).toBe(iso);
  });

  it("‼️ 이미 지난 M/D는 내년으로 — 세 필드가 모두 미래 지향이다", () => {
    // 이 규칙을 여기서 다시 적지 않고 `resolveDateInput`에 맡긴 결과다.
    expect(atEnd("마감 1/5")?.iso).toBe("2027-01-05");
  });

  it("달력에 없는 날은 알아보지 않는다", () => {
    expect(atEnd("마감 2026-02-30")).toBeNull();
  });
});

describe("‼️ 마감 표지 — 이것이 없으면 한국어에서 알아보는 것이 거의 없다", () => {
  it.each([
    ["금요일까지", "2026-09-18"],
    ["내일까지", "2026-09-17"],
    ["9월 30일까지", "2026-09-30"],
    ["3일 후까지", "2026-09-19"],
  ])("`보고서 %s` → %s", (phrase, iso) => {
    expect(atEnd(`보고서 ${phrase}`)?.iso).toBe(iso);
  });

  it("‼️ 표지까지가 한 구간이다 — `까지`가 홀로 남으면 안 된다", () => {
    const guess = atEnd("보고서 금요일까지");
    expect(guess).toMatchObject({ from: 4, to: 9 });
    expect("보고서 금요일까지".slice(4, 9)).toBe("금요일까지");
  });

  it("`by friday`의 `by`도 구간에 든다", () => {
    const guess = atEnd("report by friday");
    expect(guess?.iso).toBe("2026-09-18");
    expect("report by friday".slice(guess!.from, guess!.to)).toBe("by friday");
  });

  it("`by`가 낱말의 꼬리면 가져가지 않는다", () => {
    const guess = atEnd("standby friday");
    expect(guess?.iso).toBe("2026-09-18");
    expect("standby friday".slice(guess!.from, guess!.to)).toBe("friday");
  });

  it("표지만 있고 날짜가 없으면 아무것도 아니다", () => {
    expect(atEnd("보고서 까지")).toBeNull();
    expect(atEnd("report by")).toBeNull();
  });
});

describe("‼️ 커서에서 끝나는 것만 본다", () => {
  it("줄 가운데의 표현은 알아보지 않는다", () => {
    // 알아보면 `오늘의 할 일 정리` 같은 줄에 밑줄이 서고, 그 줄에서 Tab을 눌러
    // 들여쓰려던 사용자가 `오늘`을 잃는다. 확정 키가 들여쓰기와 같은 키다.
    expect(atEnd("오늘의 할 일 정리")).toBeNull();
    expect(atEnd("내일 회의 준비")).toBeNull();
  });

  it("커서가 표현 끝에 있으면 알아본다", () => {
    const text = "내일 회의 준비";
    expect(guessTrailingDate(text, 2, WED)?.iso).toBe("2026-09-17");
  });

  it("구간은 그 표현만 덮는다", () => {
    const guess = atEnd("보고서 다음 주 월요일");
    expect(guess).toMatchObject({ from: 4, to: 12 });
    expect("보고서 다음 주 월요일".slice(4, 12)).toBe("다음 주 월요일");
  });
});

describe("‼️ 낱말 경계", () => {
  it("다른 낱말의 꼬리를 알아보지 않는다", () => {
    expect(atEnd("xtoday")).toBeNull();
    expect(atEnd("보고서today")).toBeNull();
  });

  it("줄 처음이면 앞이 비어 있어도 된다", () => {
    expect(atEnd("내일")?.iso).toBe("2026-09-17");
  });
});

describe("‼️ 이미 필드인 자리는 건드리지 않는다", () => {
  it("`📅 2026-08-30`의 날짜를 다시 알아보지 않는다", () => {
    // 알아보면 확정이 `📅 📅2026-09-15`를 만든다. 파서가 두 형태를 다 읽으므로
    // (Obsidian Tasks가 공백 있는 쪽으로 쓴다) 이 줄은 실제로 존재한다.
    expect(atEnd("보고서 📅 2026-12-25")).toBeNull();
  });

  it("공백 없는 형태도 마찬가지다", () => {
    expect(atEnd("보고서 📅2026-12-25")).toBeNull();
  });

  it("필드 뒤에 새로 적은 말은 알아본다", () => {
    expect(atEnd("보고서 📅2026-12-25 내일")?.iso).toBe("2026-09-17");
  });
});

describe("긴 표현이 짧은 것에 먹히지 않는다", () => {
  it("`다음 주 월요일`이 `월요일`로 잘리지 않는다", () => {
    expect(atEnd("회의 다음 주 월요일")?.from).toBe(3);
  });

  it("`next friday`가 `friday`로 잘리지 않는다", () => {
    const guess = atEnd("meet next friday");
    expect(guess?.iso).toBe("2026-09-25");
    expect(guess?.from).toBe(5);
  });
});

describe("아무것도 아닌 것", () => {
  it.each(["보고서 쓰기", "", "회의", "3일", "in days", "요일"])(
    "`%s` → null",
    (text) => {
      expect(atEnd(text)).toBeNull();
    },
  );

  it("범위를 벗어난 커서 자리도 견딘다", () => {
    expect(guessTrailingDate("내일", 999, WED)?.iso).toBe("2026-09-17");
    expect(guessTrailingDate("내일", -5, WED)).toBeNull();
  });
});

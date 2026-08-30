import { describe, expect, it } from "vitest";

import { resolveDateInput } from "../task-date-input";

const TODAY = new Date(2026, 7, 23); // 2026-08-23

describe("resolveDateInput", () => {
  it("passes an absolute ISO date straight through", () => {
    expect(resolveDateInput("2027-01-05", TODAY)).toBe("2027-01-05");
  });

  it("resolves t and m to today and tomorrow", () => {
    expect(resolveDateInput("t", TODAY)).toBe("2026-08-23");
    expect(resolveDateInput("m", TODAY)).toBe("2026-08-24");
  });

  it("resolves a +N day offset", () => {
    expect(resolveDateInput("+3", TODAY)).toBe("2026-08-26");
  });

  it("expands M/D within the current year", () => {
    expect(resolveDateInput("8/30", TODAY)).toBe("2026-08-30");
    expect(resolveDateInput("12/25", TODAY)).toBe("2026-12-25");
  });

  it("rolls M/D forward a year when it would already be past", () => {
    // 이 세 필드는 전부 미래 지향이므로 한 규칙을 일관되게 적용한다
    expect(resolveDateInput("1/5", TODAY)).toBe("2027-01-05");
  });

  it("keeps today's own M/D in this year", () => {
    expect(resolveDateInput("8/23", TODAY)).toBe("2026-08-23");
  });

  it("rejects a calendar-invalid date", () => {
    expect(resolveDateInput("2/30", TODAY)).toBeNull();
    expect(resolveDateInput("13/1", TODAY)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(resolveDateInput("", TODAY)).toBeNull();
    expect(resolveDateInput("내일", TODAY)).toBeNull();
  });
});

describe("§310 쿼리가 쓰는 긴 이름과 부호 붙은 오프셋", () => {
  // 쿼리 값(`today` `+7d` `-3d`)과 에디터 입력 규칙 값(`t` `+3`)이 **한 어휘**여야
  // 한다. 쿼리 전용 날짜 파서를 따로 두면 같은 것을 두 이름으로 부르게 되고, 한쪽만
  // 고쳐지는 날이 온다.
  const TODAY = new Date(2026, 7, 30);

  it.each([
    ["today", "2026-08-30"],
    ["tomorrow", "2026-08-31"],
    ["yesterday", "2026-08-29"],
    ["+7d", "2026-09-06"],
    ["-3d", "2026-08-27"],
    ["+7", "2026-09-06"],
    ["-3", "2026-08-27"],
  ])("%s → %s", (input, expected) => {
    expect(resolveDateInput(input, TODAY)).toBe(expected);
  });

  it("한 글자 별칭은 그대로 산다", () => {
    expect(resolveDateInput("t", TODAY)).toBe("2026-08-30");
    expect(resolveDateInput("m", TODAY)).toBe("2026-08-31");
  });

  it("오프셋이 달을 넘어간다", () => {
    expect(resolveDateInput("-30d", TODAY)).toBe("2026-07-31");
  });

  it("숫자 없는 부호는 날짜가 아니다", () => {
    expect(resolveDateInput("+", TODAY)).toBeNull();
    expect(resolveDateInput("-d", TODAY)).toBeNull();
  });
});

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

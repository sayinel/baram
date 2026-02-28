/**
 * §56f Periodic note utility tests
 */
import { describe, it, expect } from "vitest";
import {
  getWeekEndDate,
  generateDefaultWeekly,
  generateDefaultMonthly,
  generateDefaultYearly,
  applyPeriodicTemplate,
} from "../journal-periodic";

describe("§56f getWeekEndDate", () => {
  it("returns Sunday for a Wednesday", () => {
    // 2026-02-25 is Wednesday → Sunday is Mar 1
    const end = getWeekEndDate(new Date(2026, 1, 25));
    expect(end.getDate()).toBe(1);
    expect(end.getMonth()).toBe(2); // March
  });

  it("returns Sunday for a Monday", () => {
    // 2026-02-23 is Monday → Sunday is Mar 1
    const end = getWeekEndDate(new Date(2026, 1, 23));
    expect(end.getDate()).toBe(1);
  });
});

describe("§56f generateDefaultWeekly", () => {
  it("includes week number and date range in frontmatter", () => {
    const content = generateDefaultWeekly(new Date(2026, 1, 28));
    expect(content).toContain("type: weekly");
    expect(content).toContain("week: W09");
    expect(content).toContain("week_start:");
    expect(content).toContain("week_end:");
  });

  it("includes heading with year and week number", () => {
    const content = generateDefaultWeekly(new Date(2026, 1, 28));
    expect(content).toContain("# 2026 Week 9");
  });

  it("has Review, Goals, Notes sections", () => {
    const content = generateDefaultWeekly(new Date(2026, 0, 5));
    expect(content).toContain("## Review");
    expect(content).toContain("## Goals");
    expect(content).toContain("## Notes");
  });
});

describe("§56f generateDefaultMonthly", () => {
  it("includes month name and year in frontmatter", () => {
    const content = generateDefaultMonthly(new Date(2026, 1, 1));
    expect(content).toContain("type: monthly");
    expect(content).toContain("month: 02");
    expect(content).toContain("year: 2026");
  });

  it("includes heading with month name", () => {
    const content = generateDefaultMonthly(new Date(2026, 1, 1));
    expect(content).toContain("# February 2026");
  });

  it("handles December correctly", () => {
    const content = generateDefaultMonthly(new Date(2025, 11, 15));
    expect(content).toContain("# December 2025");
    expect(content).toContain("month: 12");
  });
});

describe("§56f generateDefaultYearly", () => {
  it("includes year in frontmatter", () => {
    const content = generateDefaultYearly(new Date(2026, 0, 1));
    expect(content).toContain("type: yearly");
    expect(content).toContain("year: 2026");
  });

  it("includes heading with year", () => {
    const content = generateDefaultYearly(new Date(2026, 0, 1));
    expect(content).toContain("# 2026 Year in Review");
  });
});

describe("§56f applyPeriodicTemplate", () => {
  it("substitutes weekly variables", () => {
    const tpl = "Week {{week_number}}: {{week_start}} ~ {{week_end}}";
    const result = applyPeriodicTemplate(tpl, new Date(2026, 1, 28));
    expect(result).toContain("Week W09:");
    expect(result).toMatch(/2026-02-2\d/); // week start
    expect(result).toMatch(/2026-03-0\d/); // week end
  });

  it("substitutes monthly variables", () => {
    const tpl = "# {{month_name}} {{year}}";
    const result = applyPeriodicTemplate(tpl, new Date(2026, 1, 15));
    expect(result).toBe("# February 2026");
  });

  it("substitutes shared date variables", () => {
    const tpl = "{{date}} - {{year}}/{{month}}";
    const result = applyPeriodicTemplate(tpl, new Date(2026, 1, 28));
    expect(result).toBe("2026-02-28 - 2026/02");
  });

  it("handles multiple occurrences", () => {
    const tpl = "{{year}} start — {{year}} end";
    const result = applyPeriodicTemplate(tpl, new Date(2026, 5, 1));
    expect(result).toBe("2026 start — 2026 end");
  });
});

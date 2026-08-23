import type { TaskEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import { classifyTask, groupIntoBuckets, overdueDays } from "../task-buckets";

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "a.md",
    priority: 0,
    raw: "- [ ] x",
    recurrence: null,
    scheduled: null,
    start: null,
    state: "todo",
    tags: [],
    text: "x",
    ...over,
  };
}

// 2026-08-23은 일요일이다.
const SUN = new Date(2026, 7, 23, 12, 0, 0);

describe("classifyTask", () => {
  it("puts a completed task in done regardless of its due date", () => {
    expect(
      classifyTask(task({ state: "done", due: "2026-01-01" }), SUN, "monday"),
    ).toBe("done");
  });

  it("puts a task with no date in noDate", () => {
    expect(classifyTask(task(), SUN, "monday")).toBe("noDate");
  });

  it("puts a past due date in overdue", () => {
    expect(classifyTask(task({ due: "2026-08-20" }), SUN, "monday")).toBe(
      "overdue",
    );
  });

  it("puts today's due date in today, not overdue", () => {
    expect(classifyTask(task({ due: "2026-08-23" }), SUN, "monday")).toBe(
      "today",
    );
  });

  it("treats the whole due day as today up to the last minute", () => {
    const lateSunday = new Date(2026, 7, 23, 23, 59, 0);
    expect(
      classifyTask(task({ due: "2026-08-23" }), lateSunday, "monday"),
    ).toBe("today");
  });

  it("falls back to the scheduled date when there is no due date", () => {
    expect(classifyTask(task({ scheduled: "2026-08-23" }), SUN, "monday")).toBe(
      "today",
    );
  });

  it("prefers due over scheduled when both are present", () => {
    expect(
      classifyTask(
        task({ due: "2026-08-20", scheduled: "2026-12-01" }),
        SUN,
        "monday",
      ),
    ).toBe("overdue");
  });

  describe("week boundary", () => {
    // 일요일 기준: 2026-08-23이 주의 첫날 → 8/29(토)까지가 이번 주
    it("with weekStart=sunday, the following saturday is thisWeek", () => {
      expect(classifyTask(task({ due: "2026-08-29" }), SUN, "sunday")).toBe(
        "thisWeek",
      );
    });

    it("with weekStart=sunday, the next sunday is later", () => {
      expect(classifyTask(task({ due: "2026-08-30" }), SUN, "sunday")).toBe(
        "later",
      );
    });

    // 월요일 기준: 2026-08-23(일)은 8/17~8/23 주의 마지막 날 → 8/24부터는 다음 주
    it("with weekStart=monday, tomorrow already falls into later", () => {
      expect(classifyTask(task({ due: "2026-08-24" }), SUN, "monday")).toBe(
        "later",
      );
    });
  });

  it("ignores an unparseable date and treats the task as noDate", () => {
    expect(classifyTask(task({ due: "not-a-date" }), SUN, "monday")).toBe(
      "noDate",
    );
  });
});

describe("overdueDays", () => {
  it("counts whole days past the due date", () => {
    expect(overdueDays(task({ due: "2026-08-20" }), SUN)).toBe(3);
  });

  it("returns 0 for a task that is not overdue", () => {
    expect(overdueDays(task({ due: "2026-08-23" }), SUN)).toBe(0);
    expect(overdueDays(task(), SUN)).toBe(0);
  });
});

describe("groupIntoBuckets", () => {
  it("returns every bucket key even when empty", () => {
    const groups = groupIntoBuckets([], SUN, "monday");
    expect(Object.keys(groups).sort()).toEqual(
      ["done", "later", "noDate", "overdue", "thisWeek", "today"].sort(),
    );
  });

  it("sorts within a bucket by due date, then by priority descending", () => {
    const groups = groupIntoBuckets(
      [
        task({ text: "낮은 우선", due: "2026-08-20", priority: 0 }),
        task({ text: "같은 날 높은 우선", due: "2026-08-20", priority: 2 }),
        task({ text: "더 이른 기한", due: "2026-08-19" }),
      ],
      SUN,
      "monday",
    );
    expect(groups.overdue.map((t) => t.text)).toEqual([
      "더 이른 기한",
      "같은 날 높은 우선",
      "낮은 우선",
    ]);
  });
});

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
// 2026-08-26은 수요일이다 — weekStart=monday에서 thisWeek이 실제로 열리는 유일한 지점.
const WED = new Date(2026, 7, 26, 12, 0, 0);

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

    // 수요일(8/26) 기준 weekStart=monday: 그 주는 8/24~8/30 → 8/30까지 thisWeek, 8/31부터 later.
    // SUN(8/23)만으로는 weekStart=monday의 thisWeek 분기가 절대 열리지 않는다 — 이 경계를 놓치면
    // endOfWeek의 오프셋 계산이 깨져도 전체 테스트가 통과해버린다.
    it("with weekStart=monday and a mid-week now, the end of that week is thisWeek", () => {
      expect(classifyTask(task({ due: "2026-08-30" }), WED, "monday")).toBe(
        "thisWeek",
      );
    });

    it("with weekStart=monday and a mid-week now, the day after week end is later", () => {
      expect(classifyTask(task({ due: "2026-08-31" }), WED, "monday")).toBe(
        "later",
      );
    });
  });

  it("ignores an unparseable date and treats the task as noDate", () => {
    expect(classifyTask(task({ due: "not-a-date" }), SUN, "monday")).toBe(
      "noDate",
    );
  });

  it("rejects a calendar-invalid date that Date would roll over", () => {
    // new Date(2026, 1, 30)는 3월 2일로 롤오버된다 — parseLocalDate의 되돌림 검사가
    // 이걸 잡지 못하면 엉뚱한 날짜로 조용히 분류된다.
    expect(classifyTask(task({ due: "2026-02-30" }), SUN, "monday")).toBe(
      "noDate",
    );
  });

  it("falls back to scheduled when due is unparseable", () => {
    expect(
      classifyTask(
        task({ due: "not-a-date", scheduled: "2026-08-23" }),
        SUN,
        "monday",
      ),
    ).toBe("today");
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

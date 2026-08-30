import type { TaskEntry } from "../../../ipc/types";

import { describe, expect, it } from "vitest";

import {
  BUCKET_ORDER,
  classifyTask,
  groupIntoBuckets,
  lateDays,
  taskAgeDays,
} from "../task-buckets";

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

  it("puts a past scheduled date in slipped, not overdue", () => {
    // 사용자 보고: 예정일만 적은 캡처가 전부 빨간 "기한 초과"로 떴다. 아무 기한도 걸지
    // 않았는데 어겼다고 말하는 화면이라, 이 화면의 빨강이 뜻을 잃는다.
    expect(classifyTask(task({ scheduled: "2026-08-20" }), SUN, "monday")).toBe(
      "slipped",
    );
  });

  it("keeps a task with a past due date in overdue even if its scheduled date also slipped", () => {
    // 기한이 있으면 그것이 이 태스크를 지배한다 — 둘 다 지났다고 해서 덜 급해지지 않는다.
    expect(
      classifyTask(
        task({ due: "2026-08-20", scheduled: "2026-08-18" }),
        SUN,
        "monday",
      ),
    ).toBe("overdue");
  });

  it("calls a task slipped even when its due date is still ahead", () => {
    // 사용자 보고: `⏳어제 📅다음주`인 줄이 "나중"에 앉아 있었다. 한때 "기한이 있으면
    // 기한이 정한다"로 두었기 때문인데, 그러면 "예정 밀림"이라는 이름이 약속한 것과
    // 화면이 어긋난다 — 하려던 날을 넘긴 것은 마감이 남았다고 없던 일이 되지 않는다.
    expect(
      classifyTask(
        task({ due: "2026-08-29", scheduled: "2026-08-20" }),
        SUN,
        "sunday",
      ),
    ).toBe("slipped");
  });

  it("보고된 줄 그대로 — ➕오늘 ⏳어제 📅다음주는 예정 밀림이다", () => {
    // `- [ ] 7th task ➕2026-08-30 ⏳2026-08-29 📅2026-09-01 ⏫`
    const now = new Date(2026, 7, 30, 12, 0, 0);
    const entry = task({
      created: "2026-08-30",
      due: "2026-09-01",
      priority: 1,
      scheduled: "2026-08-29",
    });
    expect(classifyTask(entry, now, "monday")).toBe("slipped");
    // 주 시작 요일이 바꾸는 것은 "이번 주"의 경계뿐이다 — 밀린 것은 어느 쪽에서도 밀렸다.
    expect(classifyTask(entry, now, "sunday")).toBe("slipped");
    expect(lateDays(entry, now)).toBe(1);
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

describe("BUCKET_ORDER", () => {
  it("밀린 것 둘이 맨 위에 붙어 있다", () => {
    // 패널의 세로 순서다. "예정 밀림"이 "기한 초과" 바로 다음인 것이 이 순서의 핵심 —
    // 둘 사이에 "오늘"이 끼면 밀린 것을 두 번에 나눠 훑게 된다.
    expect(BUCKET_ORDER).toEqual([
      "overdue",
      "slipped",
      "today",
      "thisWeek",
      "later",
      "noDate",
      "done",
    ]);
  });
});

describe("lateDays", () => {
  it("counts whole days past the due date", () => {
    expect(lateDays(task({ due: "2026-08-20" }), SUN)).toBe(3);
  });

  it("counts days past the scheduled date when there is no due date", () => {
    // "예정 밀림" 행의 배지가 이 숫자다. 기한 전용으로 만들면 그 버킷의 배지가 통째로
    // 0이 되어 사라진다 — 며칠 밀렸는지가 그 버킷을 훑는 유일한 단서인데도.
    expect(lateDays(task({ scheduled: "2026-08-20" }), SUN)).toBe(3);
  });

  it("counts from the scheduled date when only it is past", () => {
    // 기한이 남은 "예정 밀림" 행. 기한 기준으로 세면 0이 되어 배지가 통째로 사라지는데,
    // 며칠 밀렸는지가 그 버킷을 훑는 유일한 단서다.
    expect(
      lateDays(task({ due: "2026-12-01", scheduled: "2026-08-20" }), SUN),
    ).toBe(3);
  });

  it("counts from the due date when both dates are past", () => {
    // 버킷을 정한 날짜와 배지가 세는 날짜가 같아야 한다. 어긋나면 "기한 초과" 행에
    // 기한이 아닌 예정일 기준의 일수가 뜬다.
    expect(
      lateDays(task({ due: "2026-08-20", scheduled: "2026-08-10" }), SUN),
    ).toBe(3);
  });

  it("returns 0 for a task that is not overdue", () => {
    expect(lateDays(task({ due: "2026-08-23" }), SUN)).toBe(0);
    expect(lateDays(task(), SUN)).toBe(0);
  });
});

describe("taskAgeDays", () => {
  const now = new Date(2026, 7, 24); // 2026-08-24

  it("created가 없으면 0", () => {
    expect(taskAgeDays(task({ created: null }), now)).toBe(0);
  });

  it("생성일로부터 지난 일수를 센다", () => {
    expect(taskAgeDays(task({ created: "2026-07-25" }), now)).toBe(30);
  });

  it("미래 날짜는 0으로 죈다", () => {
    expect(taskAgeDays(task({ created: "2026-09-01" }), now)).toBe(0);
  });

  it("형식이 틀린 값은 0", () => {
    expect(taskAgeDays(task({ created: "어제" }), now)).toBe(0);
  });
});

describe("groupIntoBuckets", () => {
  it("returns every bucket key even when empty", () => {
    const groups = groupIntoBuckets([], SUN, "monday");
    expect(Object.keys(groups).sort()).toEqual(
      [
        "done",
        "later",
        "noDate",
        "overdue",
        "slipped",
        "thisWeek",
        "today",
      ].sort(),
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

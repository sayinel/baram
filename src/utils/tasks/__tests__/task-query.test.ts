import type { TaskEntry } from "../../../ipc/types";
import type { QueryDef, QueryFilter } from "../../query-parser";

import { describe, expect, it } from "vitest";

import { applyFilters, type VaultFile } from "../../query-executor";
import { parseQueryDSL } from "../../query-parser";
import {
  applyTaskFilters,
  executeTaskQuery,
  matchesTaskFilter,
  sortTasks,
  TASK_QUERY_FIELDS,
  TASK_QUERY_OPERATORS,
} from "../task-query";

const NOW = new Date(2026, 7, 30); // 2026-08-30

function filter(
  field: string,
  operator: string,
  value = "",
  combinator: "AND" | "OR" = "AND",
): QueryFilter {
  return { combinator, field, operator, value };
}

function query(over: Partial<QueryDef> = {}): QueryDef {
  return {
    display: "list",
    filters: [],
    limit: 20,
    sort: null,
    source: "tasks",
    ...over,
  };
}

function task(over: Partial<TaskEntry> = {}): TaskEntry {
  return {
    cancelled: null,
    created: null,
    done: null,
    due: null,
    indent: 0,
    line: 0,
    links: [],
    path: "notes/a.md",
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

describe("표는 실행기와 빌더의 공통 출처다", () => {
  it("모든 필드에 연산자가 적혀 있다", () => {
    // 빌더가 이 표에서 <select>를 만든다. 필드를 더하면서 연산자를 잊으면 고를 수
    // 있는 연산자가 없는 필드가 화면에 생긴다.
    for (const field of TASK_QUERY_FIELDS) {
      expect(TASK_QUERY_OPERATORS[field], field).toBeDefined();
      expect(TASK_QUERY_OPERATORS[field].length, field).toBeGreaterThan(0);
    }
  });

  it("표에 없는 필드는 연산자를 갖지 않는다", () => {
    expect(Object.keys(TASK_QUERY_OPERATORS).sort()).toEqual(
      [...TASK_QUERY_FIELDS].sort(),
    );
  });
});

describe("matchesTaskFilter — 필드별", () => {
  it("state", () => {
    expect(matchesTaskFilter(task(), filter("state", "=", "todo"), NOW)).toBe(
      true,
    );
    expect(matchesTaskFilter(task(), filter("state", "!=", "todo"), NOW)).toBe(
      false,
    );
  });

  it("날짜 — before · after · = · empty", () => {
    const t = task({ due: "2026-09-01" });
    expect(
      matchesTaskFilter(t, filter("due", "before", "2026-09-05"), NOW),
    ).toBe(true);
    expect(
      matchesTaskFilter(t, filter("due", "after", "2026-09-05"), NOW),
    ).toBe(false);
    expect(matchesTaskFilter(t, filter("due", "=", "2026-09-01"), NOW)).toBe(
      true,
    );
    expect(matchesTaskFilter(t, filter("due", "empty"), NOW)).toBe(false);
    expect(matchesTaskFilter(task(), filter("due", "empty"), NOW)).toBe(true);
  });

  it("‼️ 상대 날짜를 에디터 입력 규칙과 같은 자로 푼다", () => {
    // 쿼리 전용 날짜 파서를 따로 두면 `+7d`가 여기서만 되거나 저기서만 되는 날이 온다.
    const soon = task({ due: "2026-09-02" });
    expect(matchesTaskFilter(soon, filter("due", "after", "today"), NOW)).toBe(
      true,
    );
    expect(matchesTaskFilter(soon, filter("due", "before", "+7d"), NOW)).toBe(
      true,
    );
    const past = task({ due: "2026-08-01" });
    expect(matchesTaskFilter(past, filter("due", "before", "-3d"), NOW)).toBe(
      true,
    );
  });

  it("해석 불가한 날짜 값은 아무것도 통과시키지 않는다", () => {
    const t = task({ due: "2026-09-01" });
    expect(matchesTaskFilter(t, filter("due", "before", "어제"), NOW)).toBe(
      false,
    );
  });

  it("priority — 부등호 포함", () => {
    const high = task({ priority: 2 });
    expect(matchesTaskFilter(high, filter("priority", ">", "1"), NOW)).toBe(
      true,
    );
    expect(matchesTaskFilter(high, filter("priority", "<", "1"), NOW)).toBe(
      false,
    );
    expect(matchesTaskFilter(high, filter("priority", "=", "2"), NOW)).toBe(
      true,
    );
    // 숫자가 아닌 값은 비교할 수 없다.
    expect(matchesTaskFilter(high, filter("priority", ">", "높음"), NOW)).toBe(
      false,
    );
  });

  it("text — 대소문자 무시 부분 일치", () => {
    const t = task({ text: "Draft the Outline" });
    expect(
      matchesTaskFilter(t, filter("text", "contains", "outline"), NOW),
    ).toBe(true);
  });

  it("tags — contains · not_contains", () => {
    const t = task({ tags: ["work"] });
    expect(matchesTaskFilter(t, filter("tags", "contains", "work"), NOW)).toBe(
      true,
    );
    expect(
      matchesTaskFilter(t, filter("tags", "not_contains", "home"), NOW),
    ).toBe(true);
  });

  it("‼️ links — 별칭과 앵커를 벗긴 대상으로 맞춘다", () => {
    // §307 A·§306과 같은 자(`linkTarget`). 벗기지 않으면 MOC 보드가 별칭 붙은 줄을
    // 통째로 놓친다 — 프로젝트 보드에서 가장 아픈 종류의 누락이다.
    for (const raw of [
      "202607051530",
      "202607051530|원자성",
      "202607051530#정의",
      "notes/202607051530.md",
    ]) {
      expect(
        matchesTaskFilter(
          task({ links: [raw] }),
          filter("links", "contains", "202607051530"),
          NOW,
        ),
        raw,
      ).toBe(true);
    }
  });

  it("path — starts · contains · regex", () => {
    const t = task({ path: "projects/alpha/todo.md" });
    expect(
      matchesTaskFilter(t, filter("path", "starts", "projects/"), NOW),
    ).toBe(true);
    expect(
      matchesTaskFilter(t, filter("path", "regex", "alpha/.*\\.md"), NOW),
    ).toBe(true);
  });

  it("깨진 정규식은 던지지 않고 통과시키지 않는다", () => {
    // 사용자가 타이핑하는 중의 정규식은 대개 깨져 있다. 던지면 블록 하나가 아니라
    // 노트 렌더 전체가 사라진다.
    expect(() =>
      matchesTaskFilter(task(), filter("path", "regex", "["), NOW),
    ).not.toThrow();
    expect(matchesTaskFilter(task(), filter("path", "regex", "["), NOW)).toBe(
      false,
    );
  });

  it("recurrence — empty · contains", () => {
    expect(matchesTaskFilter(task(), filter("recurrence", "empty"), NOW)).toBe(
      true,
    );
    expect(
      matchesTaskFilter(
        task({ recurrence: "every week" }),
        filter("recurrence", "contains", "week"),
        NOW,
      ),
    ).toBe(true);
  });

  it("‼️ 알 수 없는 필드·연산자는 던지지 않고 통과시키지 않는다", () => {
    expect(() =>
      matchesTaskFilter(task(), filter("nonsense", "=", "x"), NOW),
    ).not.toThrow();
    expect(matchesTaskFilter(task(), filter("nonsense", "=", "x"), NOW)).toBe(
      false,
    );
    // 필드는 있지만 그 필드에 뜻이 없는 연산자.
    expect(
      matchesTaskFilter(task(), filter("state", "regex", "t.*"), NOW),
    ).toBe(false);
  });
});

describe("‼️ AND/OR 묶음이 파일 실행기와 같은 뜻이다", () => {
  // 사용자에게 필터 문법은 하나다. 두 소스에서 `A OR B AND C`가 다르게 묶이면 소스마다
  // 문법을 새로 배워야 한다. 파일 쪽 `applyFilters`를 기준으로 대조한다.
  const FILTERS = [
    filter("tags", "contains", "a"),
    filter("tags", "contains", "b", "OR"),
    filter("tags", "contains", "c"),
  ];

  function asFile(tags: string[]): VaultFile {
    return { frontmatter: {}, modifiedAt: 0, name: "n", path: "p", tags };
  }

  it.each([
    [["a"], true],
    [["b"], false],
    [["b", "c"], true],
    [["c"], false],
    [[], false],
  ])("%j → %s", (tags, expected) => {
    const viaTasks = applyTaskFilters([task({ tags })], FILTERS, NOW);
    const viaFiles = applyFilters([asFile(tags)], FILTERS);
    expect(viaTasks.length > 0).toBe(expected);
    expect(viaTasks.length > 0).toBe(viaFiles.length > 0);
  });
});

describe("sortTasks", () => {
  it("‼️ 값이 없는 것은 방향과 무관하게 뒤로 간다", () => {
    // `due asc`의 맨 앞이 빈 날짜로 채워지면 목록의 머리가 쓸모없어진다.
    const rows = [
      task({ line: 1 }),
      task({ due: "2026-09-01", line: 2 }),
      task({ due: "2026-08-01", line: 3 }),
    ];
    expect(
      sortTasks(rows, { direction: "asc", field: "due" }).map((t) => t.line),
    ).toEqual([3, 2, 1]);
    expect(
      sortTasks(rows, { direction: "desc", field: "due" }).map((t) => t.line),
    ).toEqual([2, 3, 1]);
  });

  it("‼️ priority는 숫자로 비교한다", () => {
    // 문자열로 비교하면 붙어 있는 두 음수가 뒤집힌다 — localeCompare는 "-1"을 "-2"보다
    // 앞에 놓는다. 표본에 음수 둘이 없으면 문자열 비교가 우연히 같은 답을 내서 이
    // 테스트가 아무것도 가르지 못한다.
    const rows = [
      task({ line: 1, priority: -2 }),
      task({ line: 2, priority: 2 }),
      task({ line: 3, priority: 0 }),
      task({ line: 4, priority: -1 }),
    ];
    expect(
      sortTasks(rows, { direction: "asc", field: "priority" }).map(
        (t) => t.line,
      ),
    ).toEqual([1, 4, 3, 2]);
  });

  it("정렬이 없으면 원래 순서 그대로, 입력은 변형하지 않는다", () => {
    const rows = [task({ line: 1 }), task({ line: 2 })];
    expect(sortTasks(rows, null).map((t) => t.line)).toEqual([1, 2]);
    expect(rows.map((t) => t.line)).toEqual([1, 2]);
  });

  it("알 수 없는 정렬 필드는 순서를 흔들지 않는다", () => {
    const rows = [task({ line: 1 }), task({ line: 2 })];
    expect(
      sortTasks(rows, { direction: "asc", field: "nonsense" }).map(
        (t) => t.line,
      ),
    ).toEqual([1, 2]);
  });
});

describe("executeTaskQuery — 파이프라인", () => {
  it("거르고 정렬하고 자른다", () => {
    const rows = [
      task({ due: "2026-09-03", line: 1, state: "done" }),
      task({ due: "2026-09-02", line: 2 }),
      task({ due: "2026-09-01", line: 3 }),
      task({ due: "2026-09-04", line: 4 }),
    ];
    const got = executeTaskQuery(
      rows,
      query({
        filters: [filter("state", "=", "todo")],
        limit: 2,
        sort: { direction: "asc", field: "due" },
      }),
      NOW,
    );
    expect(got.map((t) => t.line)).toEqual([3, 2]);
  });

  it("§307 B — MOC 보드의 그 쿼리가 실제로 돈다", () => {
    // 설계 §18.6 B에 적힌 예제 그대로.
    const dsl = [
      "source: tasks",
      'filter: links contains "202607051530" AND state = "todo"',
      "sort: due asc",
      "display: list",
    ].join("\n");
    const rows = [
      task({ due: "2026-09-02", line: 1, links: ["202607051530"] }),
      task({ due: "2026-09-01", line: 2, links: ["202607051530|원자성"] }),
      task({ line: 3, links: ["202607051530"], state: "done" }),
      task({ line: 4, links: ["202607051531"] }),
    ];
    const got = executeTaskQuery(rows, parseQueryDSL(dsl), NOW);
    expect(got.map((t) => t.line)).toEqual([2, 1]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const rows = [task({ due: "2026-09-02", line: 1 }), task({ line: 2 })];
    executeTaskQuery(
      rows,
      query({ sort: { direction: "asc", field: "due" } }),
      NOW,
    );
    expect(rows.map((t) => t.line)).toEqual([1, 2]);
  });
});

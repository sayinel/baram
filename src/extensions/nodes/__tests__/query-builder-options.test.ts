// §310 빌더가 고르게 하는 것 — 소스마다 다르다.
import type { QueryDef } from "../../../utils/query-parser";

import { describe, expect, it } from "vitest";

import { TASK_QUERY_OPERATORS } from "../../../utils/tasks/task-query";
import {
  fieldsFor,
  isFieldOfSource,
  operatorsFor,
  retargetQuery,
} from "../query-builder-options";

function def(over: Partial<QueryDef> = {}): QueryDef {
  return {
    display: "list",
    filters: [],
    limit: 20,
    sort: null,
    source: "files",
    ...over,
  };
}

describe("fieldsFor / operatorsFor", () => {
  it("소스마다 다른 필드를 준다", () => {
    expect(fieldsFor("files")).toContain("body");
    expect(fieldsFor("files")).not.toContain("due");
    expect(fieldsFor("tasks")).toContain("due");
    expect(fieldsFor("tasks")).not.toContain("body");
  });

  it("‼️ 태스크 연산자는 실행기의 표를 그대로 쓴다", () => {
    // 빌더가 고르게 한 조합을 실행기가 통과시키지 않으면 결과가 언제나 0인데 화면은
    // 아무 말도 하지 않는다. 표가 두 벌이면 그것이 조용히 일어난다.
    for (const field of fieldsFor("tasks")) {
      expect(operatorsFor("tasks", field), field).toEqual(
        TASK_QUERY_OPERATORS[field],
      );
    }
  });

  it("모르는 필드에는 무난한 셋을 준다 — 빈 <select>를 만들지 않는다", () => {
    // 손으로 적은 DSL이 낯선 필드를 들고 빌더에 들어올 수 있다.
    expect(operatorsFor("files", "nonsense").length).toBeGreaterThan(0);
    expect(operatorsFor("tasks", "nonsense").length).toBeGreaterThan(0);
  });

  it("isFieldOfSource", () => {
    expect(isFieldOfSource("tasks", "due")).toBe(true);
    expect(isFieldOfSource("tasks", "body")).toBe(false);
    expect(isFieldOfSource("files", "tags")).toBe(true);
  });
});

describe("retargetQuery — 소스를 바꿀 때", () => {
  it("‼️ 새 소스에서 뜻이 없는 필터를 버린다", () => {
    // 그대로 들고 있으면 결과가 언제나 0인데 화면은 아무 말도 하지 않는다 — 사용자는
    // "이 소스에는 데이터가 없다"로 읽는다.
    const before = def({
      filters: [
        { combinator: "AND", field: "body", operator: "contains", value: "x" },
        { combinator: "AND", field: "path", operator: "starts", value: "p/" },
      ],
    });
    const after = retargetQuery(before, "tasks");
    expect(after.filters.map((f) => f.field)).toEqual(["path"]);
    expect(after.source).toBe("tasks");
  });

  it("정렬도 같은 규칙을 받는다", () => {
    const before = def({ sort: { direction: "desc", field: "updated_at" } });
    expect(retargetQuery(before, "tasks").sort).toBeNull();
  });

  it("두 소스에 다 있는 정렬 필드는 남는다", () => {
    const before = def({ sort: { direction: "asc", field: "path" } });
    expect(retargetQuery(before, "tasks").sort).toEqual({
      direction: "asc",
      field: "path",
    });
  });

  it("표시·제한처럼 소스와 무관한 것은 건드리지 않는다", () => {
    const before = def({ display: "table", limit: 5 });
    const after = retargetQuery(before, "tasks");
    expect(after.display).toBe("table");
    expect(after.limit).toBe(5);
  });

  it("입력을 변형하지 않는다", () => {
    const before = def({
      filters: [
        { combinator: "AND", field: "body", operator: "contains", value: "x" },
      ],
    });
    retargetQuery(before, "tasks");
    expect(before.filters).toHaveLength(1);
    expect(before.source).toBe("files");
  });
});

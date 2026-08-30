import type { QueryDef } from "../query-parser";

import { describe, expect, it } from "vitest";

import { parseQueryDSL, serializeQueryDSL } from "../query-parser";

const defaults: QueryDef = {
  filters: [],
  sort: null,
  display: "list",
  limit: 20,
  source: "files",
};

describe("parseQueryDSL", () => {
  it("empty string returns defaults", () => {
    expect(parseQueryDSL("")).toEqual(defaults);
  });

  it("blank/whitespace-only string returns defaults", () => {
    expect(parseQueryDSL("   \n  \n")).toEqual(defaults);
  });

  it("single tag filter", () => {
    const result = parseQueryDSL('filter: tags contains "skills"');
    expect(result.filters).toEqual([
      {
        field: "tags",
        operator: "contains",
        value: "skills",
        combinator: "AND",
      },
    ]);
  });

  it("AND-combined filters", () => {
    const result = parseQueryDSL(
      'filter: tags contains "skills" AND status = "draft"',
    );
    expect(result.filters).toEqual([
      {
        field: "tags",
        operator: "contains",
        value: "skills",
        combinator: "AND",
      },
      { field: "status", operator: "=", value: "draft", combinator: "AND" },
    ]);
  });

  it("OR combinator", () => {
    const result = parseQueryDSL(
      'filter: tags contains "skills" OR status = "draft"',
    );
    expect(result.filters[1].combinator).toBe("OR");
  });

  it("sort field and direction", () => {
    const result = parseQueryDSL("sort: updated_at desc");
    expect(result.sort).toEqual({ field: "updated_at", direction: "desc" });
  });

  it("sort asc direction", () => {
    const result = parseQueryDSL("sort: title asc");
    expect(result.sort).toEqual({ field: "title", direction: "asc" });
  });

  it("display mode table", () => {
    const result = parseQueryDSL("display: table");
    expect(result.display).toBe("table");
  });

  it("display mode card", () => {
    const result = parseQueryDSL("display: card");
    expect(result.display).toBe("card");
  });

  it("display mode list", () => {
    const result = parseQueryDSL("display: list");
    expect(result.display).toBe("list");
  });

  it("limit", () => {
    const result = parseQueryDSL("limit: 50");
    expect(result.limit).toBe(50);
  });

  it("full multi-line DSL", () => {
    const dsl = [
      'filter: tags contains "skills" AND status = "draft"',
      "sort: updated_at desc",
      "display: table",
      "limit: 20",
    ].join("\n");
    const result = parseQueryDSL(dsl);
    expect(result).toEqual({
      filters: [
        {
          field: "tags",
          operator: "contains",
          value: "skills",
          combinator: "AND",
        },
        { field: "status", operator: "=", value: "draft", combinator: "AND" },
      ],
      sort: { field: "updated_at", direction: "desc" },
      display: "table",
      limit: 20,
      source: "files",
    });
  });

  it("path filter with starts operator", () => {
    const result = parseQueryDSL('filter: path starts "journal/"');
    expect(result.filters).toEqual([
      {
        field: "path",
        operator: "starts",
        value: "journal/",
        combinator: "AND",
      },
    ]);
  });

  it("empty operator (no value)", () => {
    const result = parseQueryDSL("filter: status empty");
    expect(result.filters).toEqual([
      { field: "status", operator: "empty", value: "", combinator: "AND" },
    ]);
  });

  it("unknown lines are ignored", () => {
    const result = parseQueryDSL("unknown: foo\nlimit: 5");
    expect(result.limit).toBe(5);
    expect(result.filters).toEqual([]);
  });

  it("multiple filter lines — last one wins", () => {
    const dsl = 'filter: tags contains "a"\nfilter: tags contains "b"';
    const result = parseQueryDSL(dsl);
    expect(result.filters).toEqual([
      { field: "tags", operator: "contains", value: "b", combinator: "AND" },
    ]);
  });

  it("not_contains operator", () => {
    const result = parseQueryDSL('filter: tags not_contains "draft"');
    expect(result.filters[0].operator).toBe("not_contains");
  });

  it("regex operator", () => {
    const result = parseQueryDSL('filter: body regex "^TODO"');
    expect(result.filters[0]).toEqual({
      field: "body",
      operator: "regex",
      value: "^TODO",
      combinator: "AND",
    });
  });
});

// §310 source 축 — 태스크 쿼리(§307 B)가 이 위에 선다.
describe("source", () => {
  it("생략하면 files다", () => {
    expect(parseQueryDSL('filter: tags contains "a"').source).toBe("files");
  });

  it("source: tasks를 읽는다", () => {
    expect(parseQueryDSL("source: tasks").source).toBe("tasks");
  });

  it("아는 값이 아니면 기본값으로 떨어진다", () => {
    // `display`와 같은 규칙. 오타를 태스크 소스로 읽어 주는 쪽이 파일 목록을 조용히
    // 비우는 것보다 나쁘다.
    expect(parseQueryDSL("source: taks").source).toBe("files");
    expect(parseQueryDSL("source:").source).toBe("files");
  });

  it("‼️ files는 직렬화되지 않는다 — 기존 블록이 한 글자도 바뀌지 않아야 한다", () => {
    // 빌더는 편집할 때마다 이 함수의 결과로 블록 본문을 갈아 끼운다. 기본값을 뱉으면
    // 손대지도 않은 기존 블록 전부에 `source: files` 한 줄이 생긴다.
    const existing = 'filter: tags contains "skills"\nsort: updated_at desc';
    expect(serializeQueryDSL(parseQueryDSL(existing))).toBe(existing);
    expect(serializeQueryDSL(parseQueryDSL(existing))).not.toContain("source");
  });

  it("tasks는 맨 앞 줄로 직렬화된다", () => {
    const dsl = serializeQueryDSL(
      parseQueryDSL('source: tasks\nfilter: state = "todo"'),
    );
    expect(dsl.split("\n")[0]).toBe("source: tasks");
  });

  it("왕복", () => {
    const original = parseQueryDSL(
      'source: tasks\nfilter: state = "todo"\nsort: due asc',
    );
    expect(parseQueryDSL(serializeQueryDSL(original))).toEqual(original);
  });
});

describe("serializeQueryDSL", () => {
  it("defaults produces empty string", () => {
    expect(serializeQueryDSL(defaults)).toBe("");
  });

  it("single filter", () => {
    const def: QueryDef = {
      ...defaults,
      filters: [
        {
          field: "tags",
          operator: "contains",
          value: "skills",
          combinator: "AND",
        },
      ],
    };
    expect(serializeQueryDSL(def)).toBe('filter: tags contains "skills"');
  });

  it("AND-combined filters", () => {
    const def: QueryDef = {
      ...defaults,
      filters: [
        {
          field: "tags",
          operator: "contains",
          value: "skills",
          combinator: "AND",
        },
        { field: "status", operator: "=", value: "draft", combinator: "AND" },
      ],
    };
    expect(serializeQueryDSL(def)).toBe(
      'filter: tags contains "skills" AND status = "draft"',
    );
  });

  it("OR combinator", () => {
    const def: QueryDef = {
      ...defaults,
      filters: [
        { field: "tags", operator: "contains", value: "a", combinator: "AND" },
        { field: "tags", operator: "contains", value: "b", combinator: "OR" },
      ],
    };
    expect(serializeQueryDSL(def)).toBe(
      'filter: tags contains "a" OR tags contains "b"',
    );
  });

  it("sort line", () => {
    const def: QueryDef = {
      ...defaults,
      sort: { field: "updated_at", direction: "desc" },
    };
    expect(serializeQueryDSL(def)).toBe("sort: updated_at desc");
  });

  it("display table is included", () => {
    const def: QueryDef = { ...defaults, display: "table" };
    expect(serializeQueryDSL(def)).toBe("display: table");
  });

  it("display list is omitted (default)", () => {
    const def: QueryDef = { ...defaults, display: "list" };
    expect(serializeQueryDSL(def)).toBe("");
  });

  it("limit non-default is included", () => {
    const def: QueryDef = { ...defaults, limit: 50 };
    expect(serializeQueryDSL(def)).toBe("limit: 50");
  });

  it("limit 20 is omitted (default)", () => {
    const def: QueryDef = { ...defaults, limit: 20 };
    expect(serializeQueryDSL(def)).toBe("");
  });

  it("empty operator serialized without value", () => {
    const def: QueryDef = {
      ...defaults,
      filters: [
        { field: "status", operator: "empty", value: "", combinator: "AND" },
      ],
    };
    expect(serializeQueryDSL(def)).toBe("filter: status empty");
  });

  it("roundtrip: serialize then parse equals original", () => {
    const original: QueryDef = {
      filters: [
        {
          field: "tags",
          operator: "contains",
          value: "skills",
          combinator: "AND",
        },
        { field: "status", operator: "=", value: "draft", combinator: "AND" },
      ],
      sort: { field: "updated_at", direction: "desc" },
      display: "table",
      limit: 10,
      source: "files",
    };
    const serialized = serializeQueryDSL(original);
    const parsed = parseQueryDSL(serialized);
    expect(parsed).toEqual(original);
  });

  it("compact output: defaults serialize to empty string", () => {
    const result = serializeQueryDSL({
      filters: [],
      sort: null,
      display: "list",
      limit: 20,
      source: "files",
    });
    expect(result).toBe("");
  });
});

import { describe, expect, it } from "vitest";

import {
  applyFilters,
  applySort,
  executeQuery,
  matchesFilter,
  type QueryDef,
  type QueryFilter,
  type QuerySort,
  type VaultFile,
} from "../query-executor";

const files: VaultFile[] = [
  {
    path: "skills/a.md",
    name: "a.md",
    tags: ["skills", "ai"],
    frontmatter: { status: "draft" },
    modifiedAt: 1000,
    content: "Hello world",
  },
  {
    path: "skills/b.md",
    name: "b.md",
    tags: ["skills"],
    frontmatter: { status: "published" },
    modifiedAt: 2000,
    content: "Goodbye",
  },
  {
    path: "notes/c.md",
    name: "c.md",
    tags: ["notes"],
    frontmatter: {},
    modifiedAt: 3000,
    content: "TODO fix",
  },
];

// 1. matchesFilter — tags contains (true/false)
describe("matchesFilter — tags", () => {
  it("returns true when tag is in array", () => {
    const filter: QueryFilter = {
      field: "tags",
      operator: "contains",
      value: "ai",
      combinator: "AND",
    };
    expect(matchesFilter(files[0], filter)).toBe(true);
  });

  it("returns false when tag is not in array", () => {
    const filter: QueryFilter = {
      field: "tags",
      operator: "contains",
      value: "ai",
      combinator: "AND",
    };
    expect(matchesFilter(files[1], filter)).toBe(false);
  });

  it("not_contains returns true when tag is absent", () => {
    const filter: QueryFilter = {
      field: "tags",
      operator: "not_contains",
      value: "ai",
      combinator: "AND",
    };
    expect(matchesFilter(files[1], filter)).toBe(true);
  });

  it("not_contains returns false when tag is present", () => {
    const filter: QueryFilter = {
      field: "tags",
      operator: "not_contains",
      value: "ai",
      combinator: "AND",
    };
    expect(matchesFilter(files[0], filter)).toBe(false);
  });
});

// 2. matchesFilter — frontmatter = (true/false)
describe("matchesFilter — frontmatter =", () => {
  it("returns true when frontmatter value matches", () => {
    const filter: QueryFilter = {
      field: "status",
      operator: "=",
      value: "draft",
      combinator: "AND",
    };
    expect(matchesFilter(files[0], filter)).toBe(true);
  });

  it("returns false when frontmatter value does not match", () => {
    const filter: QueryFilter = {
      field: "status",
      operator: "=",
      value: "draft",
      combinator: "AND",
    };
    expect(matchesFilter(files[1], filter)).toBe(false);
  });

  it("!= returns true when frontmatter value differs", () => {
    const filter: QueryFilter = {
      field: "status",
      operator: "!=",
      value: "draft",
      combinator: "AND",
    };
    expect(matchesFilter(files[1], filter)).toBe(true);
  });
});

// 3. matchesFilter — path starts (true/false)
describe("matchesFilter — path starts", () => {
  it("returns true when path starts with value", () => {
    const filter: QueryFilter = {
      field: "path",
      operator: "starts",
      value: "skills/",
      combinator: "AND",
    };
    expect(matchesFilter(files[0], filter)).toBe(true);
  });

  it("returns false when path does not start with value", () => {
    const filter: QueryFilter = {
      field: "path",
      operator: "starts",
      value: "skills/",
      combinator: "AND",
    };
    expect(matchesFilter(files[2], filter)).toBe(false);
  });

  it("path contains", () => {
    const filter: QueryFilter = {
      field: "path",
      operator: "contains",
      value: "notes",
      combinator: "AND",
    };
    expect(matchesFilter(files[2], filter)).toBe(true);
  });

  it("path regex", () => {
    const filter: QueryFilter = {
      field: "path",
      operator: "regex",
      value: "skills/[ab]\\.md",
      combinator: "AND",
    };
    expect(matchesFilter(files[0], filter)).toBe(true);
    expect(matchesFilter(files[2], filter)).toBe(false);
  });
});

// 4. matchesFilter — body contains (case insensitive)
describe("matchesFilter — body contains", () => {
  it("matches case-insensitively", () => {
    const filter: QueryFilter = {
      field: "body",
      operator: "contains",
      value: "hello",
      combinator: "AND",
    };
    expect(matchesFilter(files[0], filter)).toBe(true);
  });

  it("returns false when not in body", () => {
    const filter: QueryFilter = {
      field: "body",
      operator: "contains",
      value: "hello",
      combinator: "AND",
    };
    expect(matchesFilter(files[1], filter)).toBe(false);
  });

  it("returns false when content is undefined", () => {
    const fileNoContent: VaultFile = {
      path: "x.md",
      name: "x.md",
      tags: [],
      frontmatter: {},
      modifiedAt: 0,
    };
    const filter: QueryFilter = {
      field: "body",
      operator: "contains",
      value: "hello",
      combinator: "AND",
    };
    expect(matchesFilter(fileNoContent, filter)).toBe(false);
  });
});

// 5. matchesFilter — empty operator
describe("matchesFilter — empty operator", () => {
  it("returns true when frontmatter key is missing", () => {
    const filter: QueryFilter = {
      field: "status",
      operator: "empty",
      value: "",
      combinator: "AND",
    };
    expect(matchesFilter(files[2], filter)).toBe(true);
  });

  it("returns false when frontmatter key has value", () => {
    const filter: QueryFilter = {
      field: "status",
      operator: "empty",
      value: "",
      combinator: "AND",
    };
    expect(matchesFilter(files[0], filter)).toBe(false);
  });
});

// 6. applyFilters — AND combination
describe("applyFilters — AND", () => {
  it("returns files matching all AND conditions", () => {
    const filters: QueryFilter[] = [
      {
        field: "tags",
        operator: "contains",
        value: "skills",
        combinator: "AND",
      },
      { field: "status", operator: "=", value: "draft", combinator: "AND" },
    ];
    const result = applyFilters(files, filters);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("a.md");
  });
});

// 7. applyFilters — OR combination
describe("applyFilters — OR", () => {
  it("returns files matching any OR group", () => {
    const filters: QueryFilter[] = [
      { field: "tags", operator: "contains", value: "ai", combinator: "AND" },
      { field: "tags", operator: "contains", value: "notes", combinator: "OR" },
    ];
    const result = applyFilters(files, filters);
    expect(result).toHaveLength(2);
    const names = result.map((f) => f.name);
    expect(names).toContain("a.md");
    expect(names).toContain("c.md");
  });
});

// 8. applySort — by modifiedAt desc
describe("applySort — modifiedAt desc", () => {
  it("sorts newest first", () => {
    const sort: QuerySort = { field: "updated_at", direction: "desc" };
    const result = applySort([...files], sort);
    expect(result[0].modifiedAt).toBe(3000);
    expect(result[1].modifiedAt).toBe(2000);
    expect(result[2].modifiedAt).toBe(1000);
  });
});

// 9. applySort — by name asc
describe("applySort — name asc", () => {
  it("sorts alphabetically", () => {
    const sort: QuerySort = { field: "name", direction: "asc" };
    const result = applySort([...files], sort);
    expect(result[0].name).toBe("a.md");
    expect(result[1].name).toBe("b.md");
    expect(result[2].name).toBe("c.md");
  });
});

// 10. applySort — null sort returns original order
describe("applySort — null sort", () => {
  it("returns a copy in original order", () => {
    const result = applySort([...files], null);
    expect(result.map((f) => f.name)).toEqual(["a.md", "b.md", "c.md"]);
  });
});

// 11. executeQuery — full pipeline (filter + sort + limit)
describe("executeQuery — full pipeline", () => {
  it("filters, sorts, and limits", () => {
    const query: QueryDef = {
      filters: [
        {
          field: "tags",
          operator: "contains",
          value: "skills",
          combinator: "AND",
        },
      ],
      sort: { field: "updated_at", direction: "desc" },
      display: "list",
      limit: 1,
    };
    const result = executeQuery(files, query);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("b.md"); // skills/b.md has modifiedAt 2000, highest among skills files
  });
});

// 12. executeQuery — empty filters returns all (sorted + limited)
describe("executeQuery — empty filters", () => {
  it("returns all files sorted and limited", () => {
    const query: QueryDef = {
      filters: [],
      sort: { field: "updated_at", direction: "asc" },
      display: "table",
      limit: 2,
    };
    const result = executeQuery(files, query);
    expect(result).toHaveLength(2);
    expect(result[0].modifiedAt).toBe(1000);
    expect(result[1].modifiedAt).toBe(2000);
  });
});

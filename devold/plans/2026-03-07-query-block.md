# Query Block (§5.13) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 비주얼 쿼리 빌더로 vault 파일을 필터/정렬/표시하는 쿼리 블록을 구현한다.

**Architecture:** Mermaid Block 패턴(fenced code block + atom NodeView)을 따른다. ` ```query ` 코드 블록을 ProseMirror atom 노드로 변환하고, React NodeView에서 비주얼 빌더 UI + 결과 표시를 렌더링한다. 쿼리 실행은 프론트엔드에서 기존 IPC(`list_dir`, `read_file`, `get_vault_tags`, `search_files`)를 조합하여 수행한다.

**Tech Stack:** Tiptap Node Extension, React NodeView, Zustand (결과 캐싱), 기존 Rust IPC

---

## Task 1: Query DSL Parser

**Files:**
- Create: `src/utils/query-parser.ts`
- Test: `src/utils/__tests__/query-parser.test.ts`

DSL 형식:
```
filter: tags contains "skills" AND status = "draft"
sort: updated_at desc
display: table
limit: 20
```

### Step 1: Write failing tests

```typescript
// src/utils/__tests__/query-parser.test.ts
import { parseQueryDSL, serializeQueryDSL, QueryDef } from "../../utils/query-parser";

describe("Query DSL Parser (§5.13)", () => {
  describe("parseQueryDSL", () => {
    it("parses empty string to defaults", () => {
      const q = parseQueryDSL("");
      expect(q).toEqual({ filters: [], sort: null, display: "list", limit: 20 });
    });

    it("parses single tag filter", () => {
      const q = parseQueryDSL('filter: tags contains "skills"');
      expect(q.filters).toEqual([
        { field: "tags", operator: "contains", value: "skills", combinator: "AND" },
      ]);
    });

    it("parses AND-combined filters", () => {
      const q = parseQueryDSL('filter: tags contains "skills" AND status = "draft"');
      expect(q.filters).toHaveLength(2);
      expect(q.filters[0]).toMatchObject({ field: "tags", operator: "contains", value: "skills" });
      expect(q.filters[1]).toMatchObject({ field: "status", operator: "=", value: "draft", combinator: "AND" });
    });

    it("parses sort field and direction", () => {
      const q = parseQueryDSL("sort: updated_at desc");
      expect(q.sort).toEqual({ field: "updated_at", direction: "desc" });
    });

    it("parses display mode", () => {
      const q = parseQueryDSL("display: table");
      expect(q.display).toBe("table");
    });

    it("parses limit", () => {
      const q = parseQueryDSL("limit: 50");
      expect(q.limit).toBe(50);
    });

    it("parses full multi-line DSL", () => {
      const dsl = [
        'filter: tags contains "skills" AND status = "draft"',
        "sort: updated_at desc",
        "display: table",
        "limit: 10",
      ].join("\n");
      const q = parseQueryDSL(dsl);
      expect(q.filters).toHaveLength(2);
      expect(q.sort).toEqual({ field: "updated_at", direction: "desc" });
      expect(q.display).toBe("table");
      expect(q.limit).toBe(10);
    });

    it("parses path filter with starts operator", () => {
      const q = parseQueryDSL('filter: path starts "skills/"');
      expect(q.filters[0]).toMatchObject({ field: "path", operator: "starts", value: "skills/" });
    });

    it("parses OR combinator", () => {
      const q = parseQueryDSL('filter: tags contains "a" OR tags contains "b"');
      expect(q.filters[1].combinator).toBe("OR");
    });
  });

  describe("serializeQueryDSL", () => {
    it("roundtrips full query", () => {
      const def: QueryDef = {
        filters: [
          { field: "tags", operator: "contains", value: "skills", combinator: "AND" },
          { field: "status", operator: "=", value: "draft", combinator: "AND" },
        ],
        sort: { field: "updated_at", direction: "desc" },
        display: "table",
        limit: 20,
      };
      const serialized = serializeQueryDSL(def);
      const reparsed = parseQueryDSL(serialized);
      expect(reparsed).toEqual(def);
    });

    it("omits default values for compact output", () => {
      const def: QueryDef = { filters: [], sort: null, display: "list", limit: 20 };
      expect(serializeQueryDSL(def)).toBe("");
    });
  });
});
```

### Step 2: Implement parser

```typescript
// src/utils/query-parser.ts — §5.13 Query DSL parser

export interface QueryFilter {
  field: string;       // tags, status, path, updated_at, body, or any frontmatter key
  operator: string;    // contains, =, !=, starts, regex, before, after
  value: string;
  combinator: "AND" | "OR";
}

export interface QuerySort {
  field: string;
  direction: "asc" | "desc";
}

export type QueryDisplay = "list" | "table" | "card";

export interface QueryDef {
  filters: QueryFilter[];
  sort: QuerySort | null;
  display: QueryDisplay;
  limit: number;
}

const DEFAULT_LIMIT = 20;
const DEFAULT_DISPLAY: QueryDisplay = "list";

export function parseQueryDSL(dsl: string): QueryDef {
  // Parse line-by-line: filter:, sort:, display:, limit:
  // Filter line: field operator "value" (AND|OR field operator "value")*
  // ...implementation...
}

export function serializeQueryDSL(def: QueryDef): string {
  // Reverse of parse — omit lines that match defaults
  // ...implementation...
}
```

### Step 3: Run tests, verify pass
### Step 4: Commit — `feat(§5.13): add query DSL parser and serializer`

---

## Task 2: Query Executor

**Files:**
- Create: `src/utils/query-executor.ts`
- Test: `src/utils/__tests__/query-executor.test.ts`

### Step 1: Write failing tests

```typescript
// src/utils/__tests__/query-executor.test.ts
import { matchesFilter, applySort, type VaultFile } from "../../utils/query-executor";

const files: VaultFile[] = [
  { path: "skills/a.md", name: "a.md", tags: ["skills", "ai"], frontmatter: { status: "draft" }, modifiedAt: 1000, content: "Hello world" },
  { path: "skills/b.md", name: "b.md", tags: ["skills"], frontmatter: { status: "published" }, modifiedAt: 2000, content: "Goodbye" },
  { path: "notes/c.md", name: "c.md", tags: ["notes"], frontmatter: {}, modifiedAt: 3000, content: "TODO fix" },
];

describe("Query Executor (§5.13)", () => {
  describe("matchesFilter", () => {
    it("tags contains", () => {
      expect(matchesFilter(files[0], { field: "tags", operator: "contains", value: "skills", combinator: "AND" })).toBe(true);
      expect(matchesFilter(files[2], { field: "tags", operator: "contains", value: "skills", combinator: "AND" })).toBe(false);
    });

    it("frontmatter equals", () => {
      expect(matchesFilter(files[0], { field: "status", operator: "=", value: "draft", combinator: "AND" })).toBe(true);
      expect(matchesFilter(files[1], { field: "status", operator: "=", value: "draft", combinator: "AND" })).toBe(false);
    });

    it("path starts", () => {
      expect(matchesFilter(files[0], { field: "path", operator: "starts", value: "skills/", combinator: "AND" })).toBe(true);
      expect(matchesFilter(files[2], { field: "path", operator: "starts", value: "skills/", combinator: "AND" })).toBe(false);
    });

    it("body contains", () => {
      expect(matchesFilter(files[2], { field: "body", operator: "contains", value: "TODO", combinator: "AND" })).toBe(true);
    });
  });

  describe("applySort", () => {
    it("sorts by modifiedAt desc", () => {
      const sorted = applySort([...files], { field: "updated_at", direction: "desc" });
      expect(sorted[0].path).toBe("notes/c.md");
    });

    it("sorts by name asc", () => {
      const sorted = applySort([...files], { field: "name", direction: "asc" });
      expect(sorted[0].name).toBe("a.md");
    });
  });
});
```

### Step 2: Implement executor

```typescript
// src/utils/query-executor.ts — §5.13 Query execution against vault files
import type { QueryDef, QueryFilter, QuerySort } from "./query-parser";

export interface VaultFile {
  path: string;
  name: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  modifiedAt: number;
  content?: string;  // lazy-loaded for body search
}

export function matchesFilter(file: VaultFile, filter: QueryFilter): boolean { ... }
export function executeQuery(files: VaultFile[], query: QueryDef): VaultFile[] { ... }
export function applySort(files: VaultFile[], sort: QuerySort | null): VaultFile[] { ... }
```

### Step 3: Run tests, verify pass
### Step 4: Commit — `feat(§5.13): add query executor with filter/sort`

---

## Task 3: Query Block Node Extension + Transformer

**Files:**
- Create: `src/extensions/nodes/query-block.ts`
- Create: `src/pipeline/transformers/query-block-transformer.ts`
- Modify: `src/pipeline/md-to-pm.ts` — add `lang === "query"` intercept (like mermaid)
- Test: `src/extensions/__tests__/query-block.test.ts`

### Step 1: Write transformer (follows mermaid-block-transformer pattern)

```typescript
// src/pipeline/transformers/query-block-transformer.ts
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Code } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const queryBlockTransformer: NodeTransformerEntry = {
  mdastType: "queryBlock",
  pmType: "queryBlock",

  mdastToPm(node: MdastNode, schema: Schema) {
    const code = node as Code;
    return schema.nodes.queryBlock.create({ query: code.value || "" });
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "code",
      lang: "query",
      value: (node.attrs.query as string) || "",
    } as Code;
  },
};
```

### Step 2: Write Node Extension

```typescript
// src/extensions/nodes/query-block.ts — §5.13 Query Block
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { QueryBlockView } from "./query-block-view";

export const QueryBlock = Node.create({
  name: "queryBlock",
  group: "block",
  atom: true,
  defining: true,

  addAttributes() {
    return {
      query: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="query-block"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "query-block" }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(QueryBlockView);
  },

  addCommands() {
    return {
      setQueryBlock: () => ({ commands }) =>
        commands.insertContent({ type: this.name, attrs: { query: "" } }),
    };
  },
});
```

### Step 3: Add `lang === "query"` intercept in md-to-pm.ts (after mermaid block)

### Step 4: Write roundtrip + structure tests

```typescript
// src/extensions/__tests__/query-block.test.ts
describe("QueryBlock Extension (§5.13)", () => {
  test.each([
    ["simple filter", '```query\nfilter: tags contains "skills"\n```'],
    ["full query", '```query\nfilter: tags contains "skills" AND status = "draft"\nsort: updated_at desc\ndisplay: table\nlimit: 20\n```'],
    ["empty query", "```query\n\n```"],
  ])("roundtrip: %s", (_, input) => { ... });

  test("PM structure: queryBlock node with query attr", () => { ... });
});
```

### Step 5: Run tests, verify pass
### Step 6: Commit — `feat(§5.13): add queryBlock extension and transformer`

---

## Task 4: Query Block NodeView (Visual Builder)

**Files:**
- Create: `src/extensions/nodes/query-block-view.tsx`

React NodeView with two modes:
1. **편집 모드**: 비주얼 빌더 (조건 추가/제거, 정렬, 표시형식, 결과 수)
2. **결과 모드**: 쿼리 결과를 list/table/card로 표시

### Step 1: Implement basic NodeView (edit mode)

- QueryBlockView component with NodeViewWrapper
- Parse `node.attrs.query` via `parseQueryDSL()`
- Condition rows: field dropdown + operator dropdown + value input
- Add/remove condition buttons
- Sort, display, limit controls
- "Run Query" button updates results
- Changes serialize back via `updateAttributes({ query: serializeQueryDSL(def) })`

### Step 2: Implement results display

- List view: file icon + name + first line preview
- Table view: columns from frontmatter fields
- Card view: 3-column grid with preview cards
- Click result → open file (via `useFileStore`)

### Step 3: Style with Tailwind

### Step 4: Commit — `feat(§5.13): add query block visual builder NodeView`

---

## Task 5: Slash Command + Registry

**Files:**
- Modify: `src/extensions/plugins/slash-command.ts` — add `/query` item
- Modify: `src/extensions/registry.json` — add queryBlock entry
- Modify: `src/extensions/nodes/index.ts` — export QueryBlock

### Step 1: Add `/query` to buildSlashItems

```typescript
{
  title: "Query",
  description: "Dynamic query block",
  icon: "🔍",
  category: "연결",
  command: ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).setQueryBlock().run();
  },
},
```

### Step 2: Add to registry.json

```json
{
  "name": "queryBlock",
  "file": "nodes/query-block.ts",
  "markdown": "```query...```",
  "spec": "§5.13",
  "phase": 3,
  "milestone": "M10",
  "status": "implemented",
  "hasNodeView": true,
  "inputRules": [],
  "shortcuts": {}
}
```

### Step 3: Export from nodes/index.ts
### Step 4: Commit — `feat(§5.13): add /query slash command and registry entry`

---

## Task 6: Integration + Hook (useQueryBlock)

**Files:**
- Create: `src/hooks/use-query-block.ts`

### Step 1: Create hook that loads vault files and executes queries

```typescript
// src/hooks/use-query-block.ts
// Uses existing IPC: list_dir (file list), read_file (frontmatter/content), get_vault_tags
// Returns: { results, loading, error, execute }
```

### Step 2: Wire into QueryBlockView
### Step 3: Commit — `feat(§5.13): add useQueryBlock hook with IPC integration`

---

## Task 7: Final Verification

### Step 1: Run full vitest suite
### Step 2: Run tsc
### Step 3: Verify roundtrip for query blocks
### Step 4: Update progress.json
### Step 5: Commit — `feat(§5.13): complete query block implementation`

---

## Dependency Graph

```
Task 1 (Parser) ──┬──→ Task 3 (Extension + Transformer) ──→ Task 5 (Slash + Registry)
Task 2 (Executor) ─┘                                    ──→ Task 4 (NodeView) ──→ Task 6 (Hook)
                                                                                 ──→ Task 7 (Verify)
```

Tasks 1 & 2 are independent (parallel). Tasks 3-5 depend on Task 1. Task 4 & 6 depend on Tasks 1+2.

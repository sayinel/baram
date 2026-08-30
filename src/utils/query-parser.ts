// §5.13 Query Block DSL — parser and serializer

export interface QueryDef {
  display: QueryDisplay;
  filters: QueryFilter[];
  limit: number;
  sort: null | QuerySort;
  /**
   * §310 무엇을 질의하는가. 생략하면 `files` — **기존 쿼리 블록은 한 글자도 바뀌지
   * 않는다**는 것이 이 축의 조건이었다.
   */
  source: QuerySource;
}

export type QueryDisplay = "card" | "list" | "table";

export interface QueryFilter {
  combinator: "AND" | "OR";
  field: string;
  operator: string;
  value: string;
}

export interface QuerySort {
  direction: "asc" | "desc";
  field: string;
}

export type QuerySource = "files" | "tasks";

const DEFAULTS: QueryDef = {
  filters: [],
  sort: null,
  display: "list",
  limit: 20,
  source: "files",
};

// Operators that carry no value
const NO_VALUE_OPERATORS = new Set(["empty"]);

/**
 * Parse the full multi-line DSL string into a QueryDef.
 * Unknown lines are silently ignored.
 */
export function parseQueryDSL(dsl: string): QueryDef {
  const result: QueryDef = { ...DEFAULTS, filters: [] };

  for (const rawLine of dsl.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    switch (key) {
      case "display":
        if (value === "table" || value === "card" || value === "list") {
          result.display = value;
        }
        break;

      case "filter":
        result.filters = parseFilterLine(value);
        break;

      case "limit": {
        const n = parseInt(value, 10);
        if (!isNaN(n)) result.limit = n;
        break;
      }

      case "sort": {
        const parts = value.split(/\s+/);
        const field = parts[0] ?? "";
        const dir = parts[1] === "asc" ? "asc" : "desc";
        if (field) result.sort = { field, direction: dir };
        break;
      }

      case "source":
        // `display`와 같은 규칙 — 아는 값일 때만 대입한다. 오타를 태스크 소스로
        // 읽어 주는 쪽이 파일 목록을 조용히 비우는 것보다 나쁘다.
        if (value === "files" || value === "tasks") result.source = value;
        break;

      default:
        // Unknown key — ignore
        break;
    }
  }

  return result;
}

/**
 * Serialize a QueryDef back to DSL text.
 * Lines that match defaults are omitted; empty QueryDef → empty string.
 */
export function serializeQueryDSL(def: QueryDef): string {
  const lines: string[] = [];

  // ‼️ `files`면 쓰지 않는다. 빌더는 편집할 때마다 이 함수의 결과로 블록 본문을
  // 갈아 끼우므로, 기본값을 뱉으면 **손대지도 않은 기존 블록 전부**에 `source: files`
  // 한 줄이 생긴다. `display`·`limit`이 같은 규칙을 따르는 이유도 같다.
  if (def.source !== "files") {
    lines.push(`source: ${def.source}`);
  }

  if (def.filters.length > 0) {
    lines.push(`filter: ${serializeFilters(def.filters)}`);
  }

  if (def.sort) {
    lines.push(`sort: ${def.sort.field} ${def.sort.direction}`);
  }

  if (def.display !== "list") {
    lines.push(`display: ${def.display}`);
  }

  if (def.limit !== 20) {
    lines.push(`limit: ${def.limit}`);
  }

  return lines.join("\n");
}

/**
 * Parse a filter line body (everything after "filter: ") into QueryFilter[].
 *
 * Grammar:
 *   filter_expr = segment (combinator segment)*
 *   segment     = field operator ("\"" value "\"")?
 *   combinator  = "AND" | "OR"
 */
function parseFilterLine(body: string): QueryFilter[] {
  const filters: QueryFilter[] = [];

  // Split on AND/OR boundaries while keeping the combinator.
  // We walk token-by-token so we can handle quoted values that might contain spaces.
  // Strategy: split the string into (combinator?, field, operator, value?) groups.

  // Tokenise: combinator keywords, quoted strings, bare words
  const tokenRe = /AND|OR|"[^"]*"|[^\s]+/g;
  const tokens: string[] = [];
  let m: null | RegExpExecArray;
  while ((m = tokenRe.exec(body)) !== null) {
    tokens.push(m[0]);
  }

  let i = 0;
  let pendingCombinator: "AND" | "OR" = "AND"; // first filter always "AND"

  while (i < tokens.length) {
    const tok = tokens[i];

    // If this token is a combinator, record it and advance
    if (tok === "AND" || tok === "OR") {
      pendingCombinator = tok;
      i++;
      continue;
    }

    // tok is field name
    const field = tok;
    i++;

    // Next token is operator
    const op = tokens[i] ?? "";
    i++;

    if (NO_VALUE_OPERATORS.has(op)) {
      filters.push({
        field,
        operator: op,
        value: "",
        combinator: pendingCombinator,
      });
      pendingCombinator = "AND";
      continue;
    }

    // Next token is quoted value
    const rawValue = tokens[i] ?? '""';
    i++;
    // Strip surrounding quotes
    const value = rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;

    filters.push({ field, operator: op, value, combinator: pendingCombinator });
    pendingCombinator = "AND";
  }

  return filters;
}

/**
 * Serialize a QueryFilter array back to the filter line body.
 */
function serializeFilters(filters: QueryFilter[]): string {
  return filters
    .map((f, idx) => {
      const prefix = idx === 0 ? "" : ` ${f.combinator} `;
      const valuePart = NO_VALUE_OPERATORS.has(f.operator)
        ? ""
        : ` "${f.value}"`;
      return `${prefix}${f.field} ${f.operator}${valuePart}`;
    })
    .join("");
}

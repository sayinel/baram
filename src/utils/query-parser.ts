// §5.13 Query Block DSL — parser and serializer

export interface QueryDef {
  display: QueryDisplay;
  filters: QueryFilter[];
  limit: number;
  sort: null | QuerySort;
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

const DEFAULTS: QueryDef = {
  filters: [],
  sort: null,
  display: "list",
  limit: 20,
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

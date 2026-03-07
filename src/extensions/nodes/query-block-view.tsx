// §5.13 Query Block NodeView — visual builder + results display
import { useState, useEffect, useCallback } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  parseQueryDSL,
  serializeQueryDSL,
  type QueryDef,
  type QueryFilter,
  type QueryDisplay,
} from "../../utils/query-parser";
import { useQueryBlock } from "../../hooks/use-query-block";
import type { VaultFile } from "../../utils/query-executor";

const FIELD_OPTIONS = [
  "tags",
  "status",
  "path",
  "body",
  "updated_at",
  "created_at",
  "name",
];
const OPERATOR_OPTIONS: Record<string, string[]> = {
  tags: ["contains", "not_contains"],
  status: ["=", "!=", "contains", "empty"],
  path: ["starts", "contains", "regex"],
  body: ["contains"],
  updated_at: ["before", "after"],
  created_at: ["before", "after"],
  name: ["contains", "starts", "="],
};
const DISPLAY_OPTIONS: QueryDisplay[] = ["list", "table", "card"];

function FilterRow({
  filter,
  index,
  onChange,
  onRemove,
}: {
  filter: QueryFilter;
  index: number;
  onChange: (index: number, updated: QueryFilter) => void;
  onRemove: (index: number) => void;
}) {
  const operators = OPERATOR_OPTIONS[filter.field] || ["=", "!=", "contains"];

  return (
    <div className="qb-filter-row">
      {index > 0 && (
        <select
          className="qb-select qb-combinator"
          value={filter.combinator}
          onChange={(e) =>
            onChange(index, {
              ...filter,
              combinator: e.target.value as "AND" | "OR",
            })
          }
        >
          <option value="AND">AND</option>
          <option value="OR">OR</option>
        </select>
      )}
      <select
        className="qb-select qb-field"
        value={filter.field}
        onChange={(e) => {
          const newField = e.target.value;
          const ops = OPERATOR_OPTIONS[newField] || ["="];
          onChange(index, { ...filter, field: newField, operator: ops[0] });
        }}
      >
        {FIELD_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <select
        className="qb-select qb-operator"
        value={filter.operator}
        onChange={(e) =>
          onChange(index, { ...filter, operator: e.target.value })
        }
      >
        {operators.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      {filter.operator !== "empty" && (
        <input
          className="qb-input qb-value"
          type={filter.field.endsWith("_at") ? "date" : "text"}
          value={filter.value}
          placeholder="value"
          onChange={(e) =>
            onChange(index, { ...filter, value: e.target.value })
          }
        />
      )}
      <button
        className="qb-btn qb-remove"
        onClick={() => onRemove(index)}
        title="Remove filter"
      >
        ×
      </button>
    </div>
  );
}

function ResultsList({
  results,
  display,
}: {
  results: VaultFile[];
  display: QueryDisplay;
}) {
  if (results.length === 0) {
    return <div className="qb-empty">No results</div>;
  }

  if (display === "table") {
    // Collect all frontmatter keys
    const keys = new Set<string>();
    results.forEach((f) =>
      Object.keys(f.frontmatter).forEach((k) => keys.add(k)),
    );
    const columns = ["name", "path", ...Array.from(keys)];

    return (
      <table className="qb-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((file) => (
            <tr key={file.path}>
              <td>{file.name}</td>
              <td className="qb-path">{file.path}</td>
              {Array.from(keys).map((k) => (
                <td key={k}>{String(file.frontmatter[k] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (display === "card") {
    return (
      <div className="qb-cards">
        {results.map((file) => (
          <div key={file.path} className="qb-card">
            <div className="qb-card-name">{file.name}</div>
            <div className="qb-card-path">{file.path}</div>
            {file.tags.length > 0 && (
              <div className="qb-card-tags">
                {file.tags.slice(0, 5).map((t) => (
                  <span key={t} className="qb-tag">
                    #{t}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Default: list
  return (
    <div className="qb-list">
      {results.map((file) => (
        <div key={file.path} className="qb-list-item">
          <span className="qb-list-name">{file.name}</span>
          <span className="qb-list-path">{file.path}</span>
        </div>
      ))}
    </div>
  );
}

export function QueryBlockView({
  node,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const queryStr = (node.attrs.query as string) || "";
  const [def, setDef] = useState<QueryDef>(() => parseQueryDSL(queryStr));
  const { results, loading, error, execute } = useQueryBlock();

  // Sync from node attrs when query changes externally
  useEffect(() => {
    const parsed = parseQueryDSL(queryStr);
    setDef(parsed);
  }, [queryStr]);

  // Auto-run query when def changes and not in edit mode
  useEffect(() => {
    if (!selected && queryStr) {
      execute(queryStr);
    }
  }, [selected, queryStr, execute]);

  const updateDef = useCallback(
    (newDef: QueryDef) => {
      setDef(newDef);
      const serialized = serializeQueryDSL(newDef);
      updateAttributes({ query: serialized });
    },
    [updateAttributes],
  );

  const handleFilterChange = useCallback(
    (index: number, updated: QueryFilter) => {
      const newFilters = [...def.filters];
      newFilters[index] = updated;
      updateDef({ ...def, filters: newFilters });
    },
    [def, updateDef],
  );

  const handleFilterRemove = useCallback(
    (index: number) => {
      const newFilters = def.filters.filter((_, i) => i !== index);
      updateDef({ ...def, filters: newFilters });
    },
    [def, updateDef],
  );

  const handleAddFilter = useCallback(() => {
    const newFilter: QueryFilter = {
      field: "tags",
      operator: "contains",
      value: "",
      combinator: "AND",
    };
    updateDef({ ...def, filters: [...def.filters, newFilter] });
  }, [def, updateDef]);

  const handleRun = useCallback(() => {
    execute(serializeQueryDSL(def));
  }, [def, execute]);

  return (
    <NodeViewWrapper className="query-block-wrapper" data-type="queryBlock">
      <div className={`qb-container ${selected ? "qb-editing" : ""}`}>
        <div className="qb-header">
          <span className="qb-title">Query</span>
          {!selected && results.length > 0 && (
            <span className="qb-count">{results.length} results</span>
          )}
        </div>

        {selected && (
          <div className="qb-builder">
            {/* Filters */}
            <div className="qb-section">
              <div className="qb-section-label">Filters</div>
              {def.filters.map((filter, i) => (
                <FilterRow
                  key={i}
                  filter={filter}
                  index={i}
                  onChange={handleFilterChange}
                  onRemove={handleFilterRemove}
                />
              ))}
              <button className="qb-btn qb-add" onClick={handleAddFilter}>
                + Add filter
              </button>
            </div>

            {/* Sort */}
            <div className="qb-section qb-row">
              <label className="qb-section-label">Sort</label>
              <select
                className="qb-select"
                value={def.sort?.field || ""}
                onChange={(e) => {
                  const field = e.target.value;
                  updateDef({
                    ...def,
                    sort: field
                      ? { field, direction: def.sort?.direction || "desc" }
                      : null,
                  });
                }}
              >
                <option value="">None</option>
                {["updated_at", "created_at", "name", "path"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              {def.sort && (
                <select
                  className="qb-select"
                  value={def.sort.direction}
                  onChange={(e) =>
                    updateDef({
                      ...def,
                      sort: {
                        ...def.sort!,
                        direction: e.target.value as "asc" | "desc",
                      },
                    })
                  }
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              )}
            </div>

            {/* Display + Limit */}
            <div className="qb-section qb-row">
              <label className="qb-section-label">Display</label>
              <select
                className="qb-select"
                value={def.display}
                onChange={(e) =>
                  updateDef({
                    ...def,
                    display: e.target.value as QueryDisplay,
                  })
                }
              >
                {DISPLAY_OPTIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <label className="qb-section-label">Limit</label>
              <input
                className="qb-input qb-limit"
                type="number"
                min={1}
                max={200}
                value={def.limit}
                onChange={(e) =>
                  updateDef({
                    ...def,
                    limit: parseInt(e.target.value, 10) || 20,
                  })
                }
              />
            </div>

            <button className="qb-btn qb-run" onClick={handleRun}>
              {loading ? "Running..." : "Run Query"}
            </button>
          </div>
        )}

        {error && <div className="qb-error">{error}</div>}

        {/* Results */}
        {results.length > 0 && (
          <div className="qb-results">
            <ResultsList results={results} display={def.display} />
          </div>
        )}

        {!selected && results.length === 0 && !loading && queryStr && (
          <div className="qb-empty">Click to edit query</div>
        )}

        {!selected && !queryStr && (
          <div className="qb-empty">Click to create a query</div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

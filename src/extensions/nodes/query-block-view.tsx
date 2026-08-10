import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { VaultFile } from "../../utils/query-executor";

import { NodeSelection } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";

import { useQueryBlock } from "../../hooks/use-query-block";
import { focusEditorView } from "../../utils/editor/focus-editor-view";
import {
  parseQueryDSL,
  type QueryDef,
  type QueryDisplay,
  type QueryFilter,
  serializeQueryDSL,
} from "../../utils/query-parser";
// §5.13 Query Block NodeView — visual builder + results display
import {
  isWysiwygVimModal,
  updateNodeAttributesWithVim,
  vimPluginKey,
} from "../plugins/vim/vim-keys";

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

export function QueryBlockView({
  node,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const queryStr = (node.attrs.query as string) || "";
  const [def, setDef] = useState<QueryDef>(() => parseQueryDSL(queryStr));
  const { results, loading, error, execute } = useQueryBlock();

  // §12-⑩ vim modal gate — event-time read via ref (not a reactive dep)
  const vimGateEditorRef = useRef(editor);
  vimGateEditorRef.current = editor;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  // A CLICK is an explicit request to edit and bypasses the modal gate;
  // keyboard traversal does not. Consumed on entry, cleared on deselect.
  const enterByClickRef = useRef(false);
  // §12-⑩ — the builder follows ENTRY, not selection (the math block's
  // model, f12e2af0, in builder form). Traversal keeps the block closed with
  // a standby INPUT mounted for vim's `i` preflight; its focus opens the
  // session and forwards into the first builder control. No save step —
  // every builder change commits immediately (tagged chrome, §12-6).
  const [isEditing, setIsEditing] = useState(false);
  const isEditingRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Session lifecycle: a selection change is the only trigger.
  useEffect(() => {
    if (!selected) {
      enterByClickRef.current = false;
      isEditingRef.current = false;
      setIsEditing(false);
    } else if (
      enterByClickRef.current ||
      !isWysiwygVimModal(vimGateEditorRef.current.state)
    ) {
      enterByClickRef.current = false;
      isEditingRef.current = true;
      setIsEditing(true);
    }
  }, [selected]);

  const editing =
    selected &&
    (isEditing ||
      enterByClickRef.current ||
      !isWysiwygVimModal(vimGateEditorRef.current.state));

  // §12-⑩ entry signal — vim's `i` preflight focuses the standby input;
  // open the session and forward focus into the first builder control AT THE
  // COMMIT that mounts it (layout effect). A setTimeout forward leaves a task
  // window where focus sits on <body>: a fast keypress lands in global
  // handlers and vim's focusout microtask briefly resumes normal mode
  // (adversarial review).
  const pendingForwardRef = useRef(false);
  const handleStandbyFocus = useCallback(() => {
    if (isEditingRef.current) {
      // Already open (the click path gives no control focus): the proxy sits
      // FIRST in DOM order, so vim's preflight finds it — forward straight
      // into the builder instead of stranding focus on a read-only hidden
      // input (adversarial re-review).
      wrapperRef.current
        ?.querySelector<HTMLElement>(".qb-builder select, .qb-builder input")
        ?.focus();
      return;
    }
    isEditingRef.current = true;
    pendingForwardRef.current = true;
    setIsEditing(true);
  }, []);
  useLayoutEffect(() => {
    if (!isEditing || !pendingForwardRef.current) return;
    pendingForwardRef.current = false;
    wrapperRef.current
      ?.querySelector<HTMLElement>(".qb-builder select, .qb-builder input")
      ?.focus();
  }, [isEditing]);

  // §298 Esc stair — Esc anywhere in the builder lands normal mode and the
  // block's NodeSelection in ONE transaction, then hands focus back. Nothing
  // to save: builder edits commit immediately. Without vim, Esc stays inert
  // (the builder never had an Esc handler).
  const handleBuilderKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (e.key !== "Escape") return;
      if (!vimPluginKey.getState(editorRef.current.state)?.enabled) return;
      e.preventDefault();
      e.stopPropagation();
      enterByClickRef.current = false;
      isEditingRef.current = false;
      setIsEditing(false);
      const editorNow = editorRef.current;
      const pos = getPos();
      const tr = editorNow.state.tr;
      if (typeof pos === "number") {
        tr.setSelection(NodeSelection.create(tr.doc, pos));
      }
      tr.setMeta(vimPluginKey, { mode: "normal", type: "setMode" });
      editorNow.view.dispatch(tr);
      focusEditorView(editorNow.view);
    },
    [getPos],
  );

  const handleWrapperClick = useCallback(() => {
    if (isEditingRef.current) return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    // Set BEFORE the selection change: the entry effect consumes the latch on
    // the render this dispatch causes; already-selected standby opens direct.
    enterByClickRef.current = true;
    editorRef.current.commands.setNodeSelection(pos);
    isEditingRef.current = true;
    setIsEditing(true);
  }, [getPos]);

  // Sync from node attrs when query changes externally
  useEffect(() => {
    const parsed = parseQueryDSL(queryStr);
    setDef(parsed);
  }, [queryStr]);

  // Auto-run on TRANSITIONS only: a session closing (Esc, or deselecting an
  // open builder) and a query change while closed. execute() recursively
  // lists the vault and reads every markdown file, so an effect keyed on
  // `selected` re-ran it on every landing/leaving of a CLOSED block — j/k
  // through a doc with query blocks launched overlapping whole-vault scans,
  // and deselecting an open builder double-fired (the deselection render,
  // then the lifecycle effect's isEditing flip). sessionOpen collapses both
  // states, so closed-to-closed selection changes never re-run the effect.
  const sessionOpen = selected && isEditing;
  const prevSessionOpenRef = useRef(false);
  const prevQueryRef = useRef<null | string>(null);
  useEffect(() => {
    const wasOpen = prevSessionOpenRef.current;
    prevSessionOpenRef.current = sessionOpen;
    const queryChanged = prevQueryRef.current !== queryStr;
    prevQueryRef.current = queryStr;
    if (!queryStr || sessionOpen) return;
    if (wasOpen || queryChanged) execute(queryStr);
  }, [sessionOpen, queryStr, execute]);

  const updateDef = useCallback(
    (newDef: QueryDef) => {
      setDef(newDef);
      const serialized = serializeQueryDSL(newDef);
      // §12-6: query-builder commit — tagged chrome (design §5b)
      updateNodeAttributesWithVim(editor, getPos, { query: serialized });
    },
    [editor, getPos],
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
    <NodeViewWrapper
      className="query-block-wrapper"
      data-type="queryBlock"
      onClick={editing ? undefined : handleWrapperClick}
      ref={wrapperRef}
      spellCheck={false}
    >
      <div className={`qb-container ${editing ? "qb-editing" : ""}`}>
        <div className="qb-header">
          <span className="qb-title">Query</span>
          {!selected && results.length > 0 && (
            <span className="qb-count">{results.length} results</span>
          )}
        </div>

        {selected && (
          // §12-⑩ standby — vim's `i` preflight queries for an input; the
          // builder only exists while editing, so this 1px inert control is
          // what it finds. Its focus opens the session (handleStandbyFocus
          // forwards into the first builder control at the mounting commit).
          // Mounted for the WHOLE selection so opening the session never
          // unmounts a focused element before the forward lands.
          <input
            aria-hidden={true}
            className="qb-standby"
            data-vim-suspend=""
            onFocus={handleStandbyFocus}
            readOnly
            tabIndex={-1}
          />
        )}
        {editing && (
          // §298 §12-3: one marker on the builder panel covers every
          // input/select/button inside it (composedPath hits it first — §4).
          <div
            className="qb-builder"
            data-vim-suspend=""
            onKeyDown={handleBuilderKeyDown}
          >
            {/* Filters */}
            <div className="qb-section">
              <div className="qb-section-label">Filters</div>
              {def.filters.map((filter, i) => (
                <FilterRow
                  filter={filter}
                  index={i}
                  key={i}
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
                onChange={(e) => {
                  const field = e.target.value;
                  updateDef({
                    ...def,
                    sort: field
                      ? { field, direction: def.sort?.direction || "desc" }
                      : null,
                  });
                }}
                value={def.sort?.field || ""}
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
                  onChange={(e) =>
                    updateDef({
                      ...def,
                      sort: {
                        ...def.sort!,
                        direction: e.target.value as "asc" | "desc",
                      },
                    })
                  }
                  value={def.sort.direction}
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
                onChange={(e) =>
                  updateDef({
                    ...def,
                    display: e.target.value as QueryDisplay,
                  })
                }
                value={def.display}
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
                max={200}
                min={1}
                onChange={(e) =>
                  updateDef({
                    ...def,
                    limit: parseInt(e.target.value, 10) || 20,
                  })
                }
                type="number"
                value={def.limit}
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
            <ResultsList display={def.display} results={results} />
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
          onChange={(e) =>
            onChange(index, {
              ...filter,
              combinator: e.target.value as "AND" | "OR",
            })
          }
          value={filter.combinator}
        >
          <option value="AND">AND</option>
          <option value="OR">OR</option>
        </select>
      )}
      <select
        className="qb-select qb-field"
        onChange={(e) => {
          const newField = e.target.value;
          const ops = OPERATOR_OPTIONS[newField] || ["="];
          onChange(index, { ...filter, field: newField, operator: ops[0] });
        }}
        value={filter.field}
      >
        {FIELD_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <select
        className="qb-select qb-operator"
        onChange={(e) =>
          onChange(index, { ...filter, operator: e.target.value })
        }
        value={filter.operator}
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
          onChange={(e) =>
            onChange(index, { ...filter, value: e.target.value })
          }
          placeholder="value"
          type={filter.field.endsWith("_at") ? "date" : "text"}
          value={filter.value}
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
  display: QueryDisplay;
  results: VaultFile[];
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
          <div className="qb-card" key={file.path}>
            <div className="qb-card-name">{file.name}</div>
            <div className="qb-card-path">{file.path}</div>
            {file.tags.length > 0 && (
              <div className="qb-card-tags">
                {file.tags.slice(0, 5).map((t) => (
                  <span className="qb-tag" key={t}>
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
        <div className="qb-list-item" key={file.path}>
          <span className="qb-list-name">{file.name}</span>
          <span className="qb-list-path">{file.path}</span>
        </div>
      ))}
    </div>
  );
}

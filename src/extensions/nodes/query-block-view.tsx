import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { VaultFile } from "../../utils/query-executor";
import type { QuerySource } from "../../utils/query-parser";

import { NodeSelection } from "@tiptap/pm/state";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";

import { TaskQueryResults } from "../../components/tasks/TaskQueryResults";
import { resultCount, useQueryBlock } from "../../hooks/use-query-block";
import { useTranslation } from "../../i18n/useTranslation";
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
import {
  fieldsFor,
  operatorsFor,
  retargetQuery,
} from "./query-builder-options";

const DISPLAY_OPTIONS: QueryDisplay[] = ["list", "table", "card"];

/**
 * 훅이 올려 보내는 **아는 실패**의 문구 키. 나머지 `error`는 예외 메시지 원문이라
 * 번역할 것이 없다 — 훅이 문장을 만들지 않고 센티널만 올리는 이유다.
 */
const ERROR_KEYS: Record<string, string> = {
  "no-vault": "query.noVault",
  "tasks-disabled": "query.tasksDisabled",
};

/** 정렬할 수 있는 필드 — 필터 필드와 다르다(본문 검색으로는 정렬할 수 없다). */
const SORT_FIELDS: Record<QuerySource, string[]> = {
  files: ["updated_at", "created_at", "name", "path"],
  tasks: ["due", "scheduled", "start", "created", "priority", "text", "path"],
};

export function QueryBlockView({
  node,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const { t } = useTranslation();
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
    // §12-⑩ modal click = NAVIGATION (issue 408, UX decision): land the
    // outline exactly like j/k and stop — `i` is the entry. Non-modal (insert
    // mode, vim off) keeps the click entry below.
    if (isWysiwygVimModal(editorRef.current.state)) {
      editorRef.current.commands.setNodeSelection(pos);
      return;
    }
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
  // §310 태스크 결과가 쓰는 "지금". 렌더마다 새로 만들면 그 값에 매달린 콜백이 매번
  // 새로 생긴다 — 아젠다가 `now`를 state로 잡아 두는 것과 같은 이유다.
  const [ranAt, setRanAt] = useState(() => new Date());
  const count = resultCount(results);
  const sessionOpen = selected && isEditing;
  const prevSessionOpenRef = useRef(false);
  const prevQueryRef = useRef<null | string>(null);
  useEffect(() => {
    const wasOpen = prevSessionOpenRef.current;
    prevSessionOpenRef.current = sessionOpen;
    const queryChanged = prevQueryRef.current !== queryStr;
    prevQueryRef.current = queryStr;
    if (!queryStr || sessionOpen) return;
    if (wasOpen || queryChanged) {
      setRanAt(new Date());
      execute(queryStr);
    }
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
    // 새 필터의 기본 필드·연산자도 소스를 따른다. `tags`로 굳어 있으면 태스크 소스에서
    // 새 필터를 더할 때마다 파일 필드가 하나씩 생긴다.
    const field = fieldsFor(def.source)[0];
    const newFilter: QueryFilter = {
      field,
      operator: operatorsFor(def.source, field)[0],
      value: "",
      combinator: "AND",
    };
    updateDef({ ...def, filters: [...def.filters, newFilter] });
  }, [def, updateDef]);

  // ‼️ 소스를 바꾸면 남아 있는 필터의 필드가 새 소스에 없을 수 있다. 그대로 두면 결과가
  // 언제나 0인데 화면은 아무 말도 하지 않는다 — 사용자는 데이터가 없다고 읽는다.
  // 정렬도 같다.
  const handleSourceChange = useCallback(
    (source: QuerySource) => updateDef(retargetQuery(def, source)),
    [def, updateDef],
  );

  // §310 결과의 한 줄이 바뀌면 질의를 다시 돌린다. 편집 세션과 무관하게 도는 경로라
  // `handleRun`(빌더의 버튼)과 따로 둔다 — 저쪽은 편집 중인 `def`를 쓰고 이쪽은
  // **문서에 적힌** 질의를 쓴다.
  const rerun = useCallback(() => {
    setRanAt(new Date());
    execute(queryStr);
  }, [execute, queryStr]);

  const handleRun = useCallback(() => {
    setRanAt(new Date());
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
          <span className="qb-title">{t("query.title")}</span>
          {!selected && count > 0 && (
            <span className="qb-count">
              {t("query.count", { count: String(count) })}
            </span>
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
            {/* §310 소스 */}
            <div className="qb-section qb-row">
              <label className="qb-section-label">{t("query.source")}</label>
              <select
                aria-label={t("query.source")}
                className="qb-select"
                onChange={(e) =>
                  handleSourceChange(e.target.value as QuerySource)
                }
                value={def.source}
              >
                <option value="files">{t("query.source.files")}</option>
                <option value="tasks">{t("query.source.tasks")}</option>
              </select>
            </div>

            {/* Filters */}
            <div className="qb-section">
              <div className="qb-section-label">{t("query.filters")}</div>
              {def.filters.map((filter, i) => (
                <FilterRow
                  filter={filter}
                  index={i}
                  key={i}
                  onChange={handleFilterChange}
                  onRemove={handleFilterRemove}
                  source={def.source}
                />
              ))}
              <button className="qb-btn qb-add" onClick={handleAddFilter}>
                {t("query.addFilter")}
              </button>
            </div>

            {/* Sort */}
            <div className="qb-section qb-row">
              <label className="qb-section-label">{t("query.sort")}</label>
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
                <option value="">{t("query.sort.none")}</option>
                {SORT_FIELDS[def.source].map((f) => (
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
                  <option value="desc">{t("query.sort.desc")}</option>
                  <option value="asc">{t("query.sort.asc")}</option>
                </select>
              )}
            </div>

            {/* Display + Limit */}
            <div className="qb-section qb-row">
              <label className="qb-section-label">{t("query.display")}</label>
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
              <label className="qb-section-label">{t("query.limit")}</label>
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
              {t(loading ? "query.running" : "query.run")}
            </button>
          </div>
        )}

        {error && (
          <div className="qb-error">
            {ERROR_KEYS[error] ? t(ERROR_KEYS[error]) : error}
          </div>
        )}

        {/* Results */}
        {count > 0 && (
          <div className="qb-results">
            {results.source === "tasks" ? (
              <TaskQueryResults
                display={def.display}
                now={ranAt}
                onChanged={rerun}
                tasks={results.tasks}
              />
            ) : (
              <ResultsList display={def.display} results={results.files} />
            )}
          </div>
        )}

        {!selected && count === 0 && !loading && queryStr && (
          <div className="qb-empty">{t("query.clickToEdit")}</div>
        )}

        {!selected && !queryStr && (
          <div className="qb-empty">{t("query.clickToCreate")}</div>
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
  source,
}: {
  filter: QueryFilter;
  index: number;
  onChange: (index: number, updated: QueryFilter) => void;
  onRemove: (index: number) => void;
  source: QuerySource;
}) {
  const { t } = useTranslation();
  const operators = operatorsFor(source, filter.field);

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
          // 필드를 바꾸면 연산자도 그 필드에서 뜻이 있는 것으로 옮긴다 — 안 그러면
          // `state regex`처럼 실행기가 통과시키지 않는 조합이 화면에 남는다.
          const ops = operatorsFor(source, newField);
          onChange(index, { ...filter, field: newField, operator: ops[0] });
        }}
        value={filter.field}
      >
        {fieldsFor(source).map((f) => (
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
        title={t("query.removeFilter")}
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
  const { t } = useTranslation();

  if (results.length === 0) {
    return <div className="qb-empty">{t("query.empty")}</div>;
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

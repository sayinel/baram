// §56k Journal Search Panel — search across journal files (daily, weekly, monthly, yearly, notes)
import { useCallback, useEffect, useRef, useState } from "react";

import type { SearchResult } from "../../ipc/types";

import { readFile, searchFiles } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { resolveJournalDir } from "../../utils/journal/journal";
import {
  CATEGORY_LABELS,
  filterByFrontmatter,
  groupSearchResults,
  hasActiveFilters,
  highlightSearchMatch,
  type JournalCategory,
  type JournalSearchFilters,
} from "../../utils/journal/journal-search";
import { logger } from "../../utils/logger";

const MAX_PER_CATEGORY = 5;

interface JournalSearchPanelProps {
  onClose?: () => void;
}

export function JournalSearchPanel({ onClose }: JournalSearchPanelProps) {
  const { journalEnabled, journalDirectory } = useSettingsStore();
  const resolvedDir = resolveJournalDir(null, journalDirectory);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<null | string>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<JournalSearchFilters>({});
  // Cache file contents for frontmatter filtering
  const contentCacheRef = useRef<Map<string, string>>(new Map());

  const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    async (q: string, activeFilters?: JournalSearchFilters) => {
      const filtersToUse = activeFilters ?? filters;
      const hasQuery = q.trim().length > 0;
      const hasFilters = hasActiveFilters(filtersToUse);

      if (!resolvedDir || (!hasQuery && !hasFilters)) {
        setResults([]);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        // searchFiles takes rootPath as first arg — pass journal dir to scope results
        const res = await searchFiles(resolvedDir, hasQuery ? q : " ", {
          maxResults: 500,
        });

        // Apply frontmatter filters client-side if any are active
        if (hasFilters) {
          // Fetch content for each result (use cache to avoid re-reads)
          const cache = contentCacheRef.current;
          const withContent = await Promise.all(
            res.map(async (r) => {
              let content = cache.get(r.filePath);
              if (content === undefined) {
                try {
                  content = await readFile(r.filePath);
                  cache.set(r.filePath, content);
                } catch {
                  content = "";
                }
              }
              return { path: r.filePath, content, original: r };
            }),
          );
          const kept = new Set(
            filterByFrontmatter(withContent, filtersToUse).map((r) => r.path),
          );
          setResults(res.filter((r) => kept.has(r.filePath)));
        } else {
          setResults(res);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [resolvedDir, filters],
  );

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 300);
    },
    [doSearch],
  );

  const handleFilterChange = useCallback(
    (next: JournalSearchFilters) => {
      setFilters(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(query, next), 300);
    },
    [doSearch, query],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        doSearch(query);
      } else if (e.key === "Escape") {
        onClose?.();
      }
    },
    [doSearch, query, onClose],
  );

  const handleResultClick = useCallback(
    (filePath: string, line: number) => {
      useLinkStore.getState().setPendingScrollLine(line);
      useUIStore.getState().setPendingSearchHighlight(query);

      const { tabs, openTab, setActiveTab } = useEditorStore.getState();
      const existing = tabs.find((t) => t.filePath === filePath);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }

      (async () => {
        try {
          const content = await readFile(filePath);
          const fileName = filePath.split("/").pop() ?? filePath;
          useFileStore.getState().setFileContent(filePath, content);
          openTab({
            contextId: "",
            id: crypto.randomUUID(),
            filePath,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        } catch (err) {
          logger.error("[JournalSearchPanel] Failed to open file:", err);
        }
      })();
    },
    [query],
  );

  if (!journalEnabled) {
    return (
      <div className="journal-search journal-search-disabled">
        Journal is disabled. Enable it in Settings &gt; General &gt; Journal.
      </div>
    );
  }

  if (!resolvedDir) {
    return (
      <div className="journal-search journal-search-disabled">
        Set the journal directory in Settings &gt; General &gt; Journal.
      </div>
    );
  }

  const adapted = adaptResults(results);
  const grouped = groupSearchResults(adapted, resolvedDir);

  const totalMatches = results.length;
  const isTagSearch = query.startsWith("#");
  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="journal-search">
      <div className="journal-search-input-row">
        <input
          aria-label="Journal search"
          className="journal-search-input"
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isTagSearch ? "Tag search: #rust…" : "Search journal… (# for tags)"
          }
          ref={inputRef}
          spellCheck={false}
          type="text"
          value={query}
        />
        <button
          aria-label="Toggle filters"
          className={`journal-search-filter-toggle ${showFilters ? "active" : ""} ${filtersActive ? "has-filters" : ""}`}
          onClick={() => setShowFilters((v) => !v)}
          title="필터"
        >
          ⊟
        </button>
        {onClose && (
          <button
            aria-label="Close"
            className="journal-search-close"
            onClick={onClose}
            title="Close journal search"
          >
            ✕
          </button>
        )}
      </div>

      {showFilters && (
        <div className="journal-search-filters">
          {/* Date range */}
          <div className="jsf-row">
            <span className="jsf-label">기간</span>
            <input
              onChange={(e) =>
                handleFilterChange({
                  ...filters,
                  dateFrom: e.target.value || undefined,
                })
              }
              type="date"
              value={filters.dateFrom ?? ""}
            />
            <span>~</span>
            <input
              onChange={(e) =>
                handleFilterChange({
                  ...filters,
                  dateTo: e.target.value || undefined,
                })
              }
              type="date"
              value={filters.dateTo ?? ""}
            />
          </div>

          {/* Tags filter — comma separated */}
          <div className="jsf-row">
            <span className="jsf-label">태그</span>
            <input
              onChange={(e) => {
                const tags = e.target.value
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean);
                handleFilterChange({
                  ...filters,
                  tagsFilter: tags.length > 0 ? tags : undefined,
                });
              }}
              placeholder="태그1, 태그2"
              type="text"
              value={(filters.tagsFilter ?? []).join(", ")}
            />
          </div>

          {/* Has photos */}
          <div className="jsf-row">
            <label className="jsf-checkbox-label">
              <input
                checked={filters.hasPhotos ?? false}
                onChange={(e) =>
                  handleFilterChange({
                    ...filters,
                    hasPhotos: e.target.checked || undefined,
                  })
                }
                type="checkbox"
              />
              사진 있는 일기만
            </label>
          </div>
        </div>
      )}

      {error && <div className="journal-search-error">{error}</div>}

      {loading && <div className="journal-search-status">Searching…</div>}

      {!loading && (query.trim() || filtersActive) && !error && (
        <div className="journal-search-status">
          {totalMatches} match{totalMatches !== 1 ? "es" : ""}
          {grouped.size > 0
            ? ` across ${grouped.size} category${grouped.size !== 1 ? "ies" : ""}`
            : ""}
          {filtersActive && (
            <span className="jsf-active-badge"> (필터 적용 중)</span>
          )}
        </div>
      )}

      {!loading &&
        (query.trim() || filtersActive) &&
        totalMatches === 0 &&
        !error && (
          <div className="journal-search-empty">No results in journal</div>
        )}

      <div className="journal-search-results">
        {[...grouped.entries()].map(([category, categoryResults]) => {
          const label = CATEGORY_LABELS[category as JournalCategory];
          const shown = categoryResults.slice(0, MAX_PER_CATEGORY);
          const overflow = categoryResults.length - shown.length;

          return (
            <div className="journal-search-category-group" key={category}>
              <div className="journal-search-category">
                {label}
                <span className="journal-search-category-count">
                  {categoryResults.length}
                </span>
              </div>
              {shown.map((match, i) => {
                const fileName =
                  match.filePath.split("/").pop() ?? match.filePath;
                const highlighted = highlightSearchMatch(match.snippet, query);
                return (
                  <div
                    className="journal-search-result"
                    key={i}
                    onClick={() =>
                      handleResultClick(match.filePath, match.line)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        handleResultClick(match.filePath, match.line);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="journal-search-result-filename">
                      {fileName}
                    </div>
                    <div
                      className="journal-search-result-snippet"
                      dangerouslySetInnerHTML={{ __html: highlighted }}
                    />
                  </div>
                );
              })}
              {overflow > 0 && (
                <div className="journal-search-overflow">
                  +{overflow} more in {label.toLowerCase()}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Adapt SearchResult (filePath) to the shape groupSearchResults expects (path) */
function adaptResults(
  results: SearchResult[],
): Array<SearchResult & { path: string }> {
  return results.map((r) => ({ ...r, path: r.filePath }));
}

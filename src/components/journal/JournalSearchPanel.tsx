// §56k Journal Search Panel — search across journal files (daily, weekly, monthly, yearly, notes)
import { useState, useCallback, useRef, useEffect } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useLinkStore } from "../../stores/link-store";
import { useUIStore } from "../../stores/ui-store";
import { searchFiles, readFile } from "../../ipc/invoke";
import {
  groupSearchResults,
  highlightSearchMatch,
  filterByFrontmatter,
  hasActiveFilters,
  CATEGORY_LABELS,
  type JournalCategory,
  type JournalSearchFilters,
} from "../../utils/journal-search";
import { resolveJournalDir } from "../../utils/journal";
import type { SearchResult } from "../../ipc/types";

const MAX_PER_CATEGORY = 5;

interface JournalSearchPanelProps {
  onClose?: () => void;
}

/** Adapt SearchResult (filePath) to the shape groupSearchResults expects (path) */
function adaptResults(
  results: SearchResult[],
): Array<SearchResult & { path: string }> {
  return results.map((r) => ({ ...r, path: r.filePath }));
}

export function JournalSearchPanel({ onClose }: JournalSearchPanelProps) {
  const { journalEnabled, journalDirectory } = useSettingsStore();
  const resolvedDir = resolveJournalDir(null, journalDirectory);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<JournalSearchFilters>({});
  // Cache file contents for frontmatter filtering
  const contentCacheRef = useRef<Map<string, string>>(new Map());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
            id: crypto.randomUUID(),
            filePath,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        } catch (err) {
          console.error("[JournalSearchPanel] Failed to open file:", err);
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

  const MOODS = ["deep", "calm", "neutral", "warm", "bright"] as const;

  return (
    <div className="journal-search">
      <div className="journal-search-input-row">
        <input
          ref={inputRef}
          className="journal-search-input"
          type="text"
          placeholder={
            isTagSearch ? "Tag search: #rust…" : "Search journal… (# for tags)"
          }
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          aria-label="Journal search"
        />
        <button
          className={`journal-search-filter-toggle ${showFilters ? "active" : ""} ${filtersActive ? "has-filters" : ""}`}
          onClick={() => setShowFilters((v) => !v)}
          title="필터"
          aria-label="Toggle filters"
        >
          ⊟
        </button>
        {onClose && (
          <button
            className="journal-search-close"
            onClick={onClose}
            title="Close journal search"
            aria-label="Close"
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
              type="date"
              value={filters.dateFrom ?? ""}
              onChange={(e) =>
                handleFilterChange({
                  ...filters,
                  dateFrom: e.target.value || undefined,
                })
              }
            />
            <span>~</span>
            <input
              type="date"
              value={filters.dateTo ?? ""}
              onChange={(e) =>
                handleFilterChange({
                  ...filters,
                  dateTo: e.target.value || undefined,
                })
              }
            />
          </div>

          {/* Mood filter — 5 clickable dots */}
          <div className="jsf-row">
            <span className="jsf-label">기분</span>
            <div className="jsf-mood-dots">
              {MOODS.map((mood) => (
                <button
                  key={mood}
                  className={`jsf-mood-dot ${(filters.moodFilter ?? []).includes(mood) ? "active" : ""}`}
                  data-mood={mood}
                  title={mood}
                  onClick={() => {
                    const current = filters.moodFilter ?? [];
                    const next = current.includes(mood)
                      ? current.filter((m) => m !== mood)
                      : [...current, mood];
                    handleFilterChange({
                      ...filters,
                      moodFilter: next.length > 0 ? next : undefined,
                    });
                  }}
                />
              ))}
            </div>
          </div>

          {/* Tags filter — comma separated */}
          <div className="jsf-row">
            <span className="jsf-label">태그</span>
            <input
              type="text"
              placeholder="태그1, 태그2"
              value={(filters.tagsFilter ?? []).join(", ")}
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
            />
          </div>

          {/* Energy minimum */}
          <div className="jsf-row">
            <span className="jsf-label">에너지</span>
            <select
              value={filters.energyMin ?? ""}
              onChange={(e) =>
                handleFilterChange({
                  ...filters,
                  energyMin: e.target.value
                    ? parseInt(e.target.value)
                    : undefined,
                })
              }
            >
              <option value="">전체</option>
              <option value="1">1 이상</option>
              <option value="2">2 이상</option>
              <option value="3">3 이상</option>
              <option value="4">4 이상</option>
              <option value="5">5</option>
            </select>
          </div>

          {/* Has photos */}
          <div className="jsf-row">
            <label className="jsf-checkbox-label">
              <input
                type="checkbox"
                checked={filters.hasPhotos ?? false}
                onChange={(e) =>
                  handleFilterChange({
                    ...filters,
                    hasPhotos: e.target.checked || undefined,
                  })
                }
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
            <div key={category} className="journal-search-category-group">
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
                    key={i}
                    className="journal-search-result"
                    onClick={() =>
                      handleResultClick(match.filePath, match.line)
                    }
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        handleResultClick(match.filePath, match.line);
                      }
                    }}
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

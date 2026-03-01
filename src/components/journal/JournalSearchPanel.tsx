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
  CATEGORY_LABELS,
  type JournalCategory,
} from "../../utils/journal-search";
import { resolveJournalDir } from "../../utils/journal";
import type { SearchResult } from "../../ipc/types";

const MAX_PER_CATEGORY = 5;

interface JournalSearchPanelProps {
  onClose?: () => void;
}

/** Adapt SearchResult (filePath) to the shape groupSearchResults expects (path) */
function adaptResults(results: SearchResult[]): Array<SearchResult & { path: string }> {
  return results.map((r) => ({ ...r, path: r.filePath }));
}

export function JournalSearchPanel({ onClose }: JournalSearchPanelProps) {
  const { journalEnabled, journalDirectory } = useSettingsStore();
  const resolvedDir = resolveJournalDir(null, journalDirectory);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (!resolvedDir || !q.trim()) {
        setResults([]);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        // searchFiles takes rootPath as first arg — pass journal dir to scope results
        const res = await searchFiles(resolvedDir, q, {
          maxResults: 500,
        });
        setResults(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [resolvedDir],
  );

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 300);
    },
    [doSearch],
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

  return (
    <div className="journal-search">
      <div className="journal-search-input-row">
        <input
          ref={inputRef}
          className="journal-search-input"
          type="text"
          placeholder={isTagSearch ? "Tag search: #rust…" : "Search journal… (# for tags)"}
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          aria-label="Journal search"
        />
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

      {error && <div className="journal-search-error">{error}</div>}

      {loading && <div className="journal-search-status">Searching…</div>}

      {!loading && query.trim() && !error && (
        <div className="journal-search-status">
          {totalMatches} match{totalMatches !== 1 ? "es" : ""}
          {grouped.size > 0 ? ` across ${grouped.size} category${grouped.size !== 1 ? "ies" : ""}` : ""}
        </div>
      )}

      {!loading && query.trim() && totalMatches === 0 && !error && (
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
                const fileName = match.filePath.split("/").pop() ?? match.filePath;
                const highlighted = highlightSearchMatch(match.snippet, query);
                return (
                  <div
                    key={i}
                    className="journal-search-result"
                    onClick={() => handleResultClick(match.filePath, match.line)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        handleResultClick(match.filePath, match.line);
                      }
                    }}
                  >
                    <div className="journal-search-result-filename">{fileName}</div>
                    <div
                      className="journal-search-result-snippet"
                      // eslint-disable-next-line react/no-danger
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

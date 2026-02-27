// §5.11 Global Search (Cmd+Shift+F) — vault-wide text search panel
import { useState, useCallback, useRef, useEffect } from "react";
import { useFileStore } from "../../stores/file-store";
import { useEditorStore } from "../../stores/editor-store";
import { useUIStore } from "../../stores/ui-store";
import { useLinkStore } from "../../stores/link-store";
import { searchFiles, readFile, writeFile } from "../../ipc/invoke";
import { extractFileNameFromPath } from "./backlink-utils";
import type { SearchResult } from "../../ipc/types";

interface FileGroup {
  filePath: string;
  fileName: string;
  matches: SearchResult[];
}

function groupByFile(results: SearchResult[]): FileGroup[] {
  const map = new Map<string, SearchResult[]>();
  for (const r of results) {
    const existing = map.get(r.filePath);
    if (existing) {
      existing.push(r);
    } else {
      map.set(r.filePath, [r]);
    }
  }
  return Array.from(map.entries()).map(([filePath, matches]) => ({
    filePath,
    fileName: extractFileNameFromPath(filePath),
    matches,
  }));
}

export function GlobalSearch() {
  const rootPath = useFileStore((s) => s.rootPath);

  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());

  const [showReplace, setShowReplace] = useState(false);
  const [replaceText, setReplaceText] = useState("");
  const [includeFilter, setIncludeFilter] = useState("");
  const [excludeFilter, setExcludeFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    async (q: string) => {
      if (!rootPath || !q.trim()) {
        setResults([]);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await searchFiles(rootPath, q, {
          caseSensitive,
          wholeWord,
          regex: useRegex,
          maxResults: 1000,
          includeGlob: includeFilter.trim() || undefined,
          excludeGlob: excludeFilter.trim() || undefined,
        });
        setResults(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
      } finally {
        setLoading(false);
      }
    },
    [rootPath, caseSensitive, wholeWord, useRegex, includeFilter, excludeFilter],
  );

  // Debounced search on query change
  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 300);
    },
    [doSearch],
  );

  // Re-search when toggle options change
  useEffect(() => {
    if (query.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(query), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseSensitive, wholeWord, useRegex, includeFilter, excludeFilter]);

  const toggleCollapse = (filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  };

  // Navigate to file + line + highlight search term
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
          const fileName = extractFileNameFromPath(filePath);
          useFileStore.getState().setFileContent(filePath, content);
          openTab({
            id: crypto.randomUUID(),
            filePath,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        } catch (err) {
          console.error("[GlobalSearch] Failed to open file:", err);
        }
      })();
    },
    [query],
  );

  // Replace a single match on the given line
  const handleReplace = useCallback(
    async (filePath: string, line: number) => {
      setReplacing(true);
      try {
        // Read from file-store cache (open file) or disk
        const cached = useFileStore.getState().openFiles.get(filePath);
        const content = cached ?? (await readFile(filePath));
        const lines = content.split("\n");
        const lineIdx = line - 1;
        if (lineIdx >= 0 && lineIdx < lines.length) {
          const originalLine = lines[lineIdx];
          let searchText = query;
          if (!useRegex)
            searchText = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (wholeWord) searchText = `\\b${searchText}\\b`;
          const flags = caseSensitive ? "" : "i"; // replace first occurrence only
          const re = new RegExp(searchText, flags);
          const newLine = originalLine.replace(re, replaceText);
          if (newLine !== originalLine) {
            lines[lineIdx] = newLine;
            const newContent = lines.join("\n");
            await writeFile(filePath, newContent);
            // Sync editor cache if file is open
            if (cached !== undefined) {
              useFileStore.getState().setFileContent(filePath, newContent);
            }
          }
        }
        // Signal editor to reload content from file-store
        useUIStore.getState().triggerContentReload();
        await doSearch(query);
      } catch (err) {
        console.error("[GlobalSearch] Replace failed:", err);
      } finally {
        setReplacing(false);
      }
    },
    [query, replaceText, caseSensitive, wholeWord, useRegex, doSearch],
  );

  // Replace all matches across all files
  const handleReplaceAll = useCallback(async () => {
    if (!query.trim()) return;
    setReplacing(true);
    try {
      let searchText = query;
      if (!useRegex) searchText = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (wholeWord) searchText = `\\b${searchText}\\b`;
      const flags = caseSensitive ? "g" : "gi";
      const re = new RegExp(searchText, flags);

      const groups = groupByFile(results);
      const { openFiles, setFileContent } = useFileStore.getState();

      for (const group of groups) {
        const cached = openFiles.get(group.filePath);
        const content = cached ?? (await readFile(group.filePath));
        const newContent = content.replace(re, replaceText);
        if (newContent !== content) {
          await writeFile(group.filePath, newContent);
          // Sync editor cache if file is open
          if (cached !== undefined) {
            setFileContent(group.filePath, newContent);
          }
        }
      }
      // Signal editor to reload content from file-store
      useUIStore.getState().triggerContentReload();
      await doSearch(query);
    } catch (err) {
      console.error("[GlobalSearch] Replace All failed:", err);
    } finally {
      setReplacing(false);
    }
  }, [query, replaceText, caseSensitive, wholeWord, useRegex, results, doSearch]);

  const groups = groupByFile(results);
  const fileCount = groups.length;
  const matchCount = results.length;

  if (!rootPath) {
    return <div className="global-search-empty">Open a folder to search</div>;
  }

  return (
    <div className="global-search">
      <div className="global-search-header">Search</div>

      <div className="global-search-input-row">
        <input
          ref={inputRef}
          className="global-search-input"
          type="text"
          placeholder="Search across files…"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="global-search-toggles">
        <button
          className={`global-search-toggle ${caseSensitive ? "global-search-toggle-active" : ""}`}
          onClick={() => setCaseSensitive(!caseSensitive)}
          title="Match Case"
        >
          Aa
        </button>
        <button
          className={`global-search-toggle ${wholeWord ? "global-search-toggle-active" : ""}`}
          onClick={() => setWholeWord(!wholeWord)}
          title="Match Whole Word"
        >
          W
        </button>
        <button
          className={`global-search-toggle ${useRegex ? "global-search-toggle-active" : ""}`}
          onClick={() => setUseRegex(!useRegex)}
          title="Use Regular Expression"
        >
          .*
        </button>
        <button
          className={`global-search-toggle ${showReplace ? "global-search-toggle-active" : ""}`}
          onClick={() => setShowReplace(!showReplace)}
          title="Toggle Replace"
        >
          ↔
        </button>
        <button
          className={`global-search-toggle ${showFilters ? "global-search-toggle-active" : ""}`}
          onClick={() => setShowFilters(!showFilters)}
          title="Toggle File Filters"
        >
          ⊞
        </button>
      </div>

      {showReplace && (
        <div className="global-search-replace-row">
          <input
            className="global-search-input"
            type="text"
            placeholder="Replace with…"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            spellCheck={false}
          />
          <div className="global-search-replace-actions">
            <button
              className="global-search-replace-btn"
              onClick={handleReplaceAll}
              disabled={replacing || !query.trim()}
              title="Replace All (in unopened files)"
            >
              Replace All
            </button>
          </div>
        </div>
      )}

      {showFilters && (
        <div className="global-search-filters">
          <input
            className="global-search-filter-input"
            type="text"
            placeholder="Include: *.md, docs/**"
            value={includeFilter}
            onChange={(e) => setIncludeFilter(e.target.value)}
            spellCheck={false}
          />
          <input
            className="global-search-filter-input"
            type="text"
            placeholder="Exclude: drafts/, archive/"
            value={excludeFilter}
            onChange={(e) => setExcludeFilter(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}

      {error && <div className="global-search-error">{error}</div>}

      {!loading && query.trim() && !error && (
        <div className="global-search-status">
          {matchCount} match{matchCount !== 1 ? "es" : ""} in {fileCount} file
          {fileCount !== 1 ? "s" : ""}
        </div>
      )}

      {loading && <div className="global-search-status">Searching…</div>}

      <div className="global-search-results">
        {groups.map((group) => {
          const collapsed = collapsedFiles.has(group.filePath);
          return (
            <div key={group.filePath} className="global-search-group">
              <div
                className="global-search-file"
                onClick={() => toggleCollapse(group.filePath)}
              >
                <span className="global-search-chevron">
                  {collapsed ? "▸" : "▾"}
                </span>
                <span className="global-search-file-name">
                  {group.fileName}
                </span>
                <span className="global-search-file-count">
                  {group.matches.length}
                </span>
              </div>
              {!collapsed &&
                group.matches.map((match, i) => (
                  <div
                    key={i}
                    className="global-search-match"
                    onClick={() =>
                      handleResultClick(match.filePath, match.line)
                    }
                  >
                    <span className="global-search-line">
                      L{match.line}
                    </span>
                    <span className="global-search-snippet">
                      {match.snippet}
                    </span>
                    {showReplace && (
                      <button
                        className="global-search-replace-one"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReplace(match.filePath, match.line);
                        }}
                        title="Replace this match"
                      >
                        ↔
                      </button>
                    )}
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

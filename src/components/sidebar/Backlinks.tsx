// §29 백링크 패널 — 현재 파일을 참조하는 다른 파일 목록
// §34 언링크드 멘션 — [[]] 없이 파일명이 언급된 곳 표시
import { useEffect, useCallback } from "react";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useLinkStore } from "../../stores/link-store";
import { getBacklinks, getUnlinkedMentions, refreshIndex, readFile, writeFile, updateFileIndex } from "../../ipc/invoke";
import {
  groupBacklinksByFile,
  extractFileNameFromPath,
} from "./backlink-utils";
import type { UnlinkedMention } from "../../ipc/types";

/** Group unlinked mentions by source file */
function groupUnlinkedByFile(
  entries: UnlinkedMention[],
): { sourcePath: string; entries: UnlinkedMention[] }[] {
  if (entries.length === 0) return [];

  const map = new Map<string, UnlinkedMention[]>();
  for (const entry of entries) {
    const existing = map.get(entry.sourcePath);
    if (existing) {
      existing.push(entry);
    } else {
      map.set(entry.sourcePath, [entry]);
    }
  }

  return Array.from(map.entries()).map(([sourcePath, groupEntries]) => ({
    sourcePath,
    entries: groupEntries,
  }));
}

export function Backlinks() {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const rootPath = useFileStore((s) => s.rootPath);
  const { backlinks, unlinkedMentions, loading, error, indexVersion, setBacklinks, setUnlinkedMentions, setLoading, setError } =
    useLinkStore();

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;

  // Fetch backlinks when active file changes
  const fetchBacklinks = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const entries = await getBacklinks(path);
        setBacklinks(path, entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [setBacklinks, setLoading, setError],
  );

  // §34 Fetch unlinked mentions
  const fetchUnlinkedMentions = useCallback(
    async (path: string, root: string) => {
      try {
        const entries = await getUnlinkedMentions(path, root);
        setUnlinkedMentions(entries);
      } catch {
        // Non-fatal — silently ignore
        setUnlinkedMentions([]);
      }
    },
    [setUnlinkedMentions],
  );

  // Build index on vault open, then fetch backlinks
  useEffect(() => {
    if (!rootPath) return;

    let cancelled = false;
    (async () => {
      try {
        await refreshIndex(rootPath);
      } catch {
        // Index build failure is non-fatal
      }
      if (!cancelled && filePath) {
        fetchBacklinks(filePath);
        fetchUnlinkedMentions(filePath, rootPath);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Only re-run when rootPath changes (full rebuild)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  // Fetch backlinks + unlinked mentions when active file changes or index is updated
  useEffect(() => {
    if (filePath) {
      fetchBacklinks(filePath);
      if (rootPath) {
        fetchUnlinkedMentions(filePath, rootPath);
      }
    }
  }, [filePath, rootPath, indexVersion, fetchBacklinks, fetchUnlinkedMentions]);

  // Handle clicking a backlink entry → open that file and scroll to line
  const handleClick = useCallback(
    (sourcePath: string, line: number, blockId?: string) => {
      if (blockId) {
        useLinkStore.getState().setPendingScrollBlockId(blockId);
      } else {
        useLinkStore.getState().setPendingScrollLine(line);
      }

      const { tabs: currentTabs, openTab, setActiveTab } =
        useEditorStore.getState();
      const existing = currentTabs.find((t) => t.filePath === sourcePath);
      if (existing) {
        setActiveTab(existing.id);
        return;
      }

      // Open the file
      (async () => {
        try {
          const content = await readFile(sourcePath);
          const fileName = extractFileNameFromPath(sourcePath);
          useFileStore.getState().setFileContent(sourcePath, content);
          openTab({
            id: crypto.randomUUID(),
            filePath: sourcePath,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        } catch (err) {
          console.error("[Backlinks] Failed to open file:", err);
        }
      })();
    },
    [],
  );

  // §34 Convert unlinked mention to wikilink
  const handleLinkify = useCallback(
    async (mention: UnlinkedMention) => {
      if (!filePath || !rootPath) return;

      const currentStem = extractFileNameFromPath(filePath).replace(/\.md$/, "");

      try {
        const content = await readFile(mention.sourcePath);
        const lines = content.split("\n");
        const lineIdx = mention.line - 1; // 1-based to 0-based

        if (lineIdx < 0 || lineIdx >= lines.length) return;

        // Replace the first occurrence of matchText on this line with [[target]]
        const line = lines[lineIdx];
        const matchIdx = line.toLowerCase().indexOf(mention.matchText.toLowerCase());
        if (matchIdx === -1) return;

        const before = line.slice(0, matchIdx);
        const matched = line.slice(matchIdx, matchIdx + mention.matchText.length);
        const after = line.slice(matchIdx + mention.matchText.length);

        // If matchText differs from stem (including case), use alias syntax: [[stem|matchText]]
        const wikilink = matched === currentStem
          ? `[[${currentStem}]]`
          : `[[${currentStem}|${matched}]]`;

        lines[lineIdx] = before + wikilink + after;
        const newContent = lines.join("\n");

        await writeFile(mention.sourcePath, newContent);

        // Update index and refresh
        await updateFileIndex(mention.sourcePath);
        useLinkStore.getState().invalidate();
      } catch (err) {
        console.error("[Backlinks] Failed to linkify:", err);
      }
    },
    [filePath, rootPath],
  );

  if (!filePath) {
    return <div className="backlinks-empty">No file open</div>;
  }

  if (loading) {
    return <div className="backlinks-empty">Loading backlinks…</div>;
  }

  if (error) {
    return <div className="backlinks-empty backlinks-error">{error}</div>;
  }

  const groups = groupBacklinksByFile(backlinks);
  const unlinkedGroups = groupUnlinkedByFile(unlinkedMentions);

  return (
    <div className="backlinks">
      {/* §29 Linked backlinks */}
      <div className="backlinks-header">
        Backlinks ({backlinks.length})
      </div>
      {groups.length === 0 ? (
        <div className="backlinks-empty-inline">
          No backlinks to{" "}
          <strong>{extractFileNameFromPath(filePath)}</strong>
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.sourcePath} className="backlinks-group">
            <div
              className="backlinks-source"
              onClick={() => handleClick(group.sourcePath, group.entries[0].line)}
            >
              {extractFileNameFromPath(group.sourcePath)}
            </div>
            {group.entries.map((entry, i) => (
              <div
                key={i}
                className="backlinks-context"
                onClick={() => handleClick(group.sourcePath, entry.line, entry.blockId)}
              >
                <span className="backlinks-line">L{entry.line}</span>
                <span className="backlinks-text">{entry.context}</span>
                {entry.blockId && (
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: "0.65rem",
                      padding: "0 4px",
                      borderRadius: "3px",
                      background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
                      color: "var(--color-accent)",
                    }}
                  >
                    ^{entry.blockId}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))
      )}

      {/* §34 Unlinked mentions */}
      <div className="backlinks-header backlinks-header-unlinked">
        Unlinked Mentions ({unlinkedMentions.length})
      </div>
      {unlinkedGroups.length === 0 ? (
        <div className="backlinks-empty-inline">
          No unlinked mentions found
        </div>
      ) : (
        unlinkedGroups.map((group) => (
          <div key={group.sourcePath} className="backlinks-group">
            <div
              className="backlinks-source"
              onClick={() => handleClick(group.sourcePath, group.entries[0].line)}
            >
              {extractFileNameFromPath(group.sourcePath)}
            </div>
            {group.entries.map((entry, i) => (
              <div key={i} className="backlinks-context">
                <span
                  className="backlinks-text"
                  onClick={() => handleClick(group.sourcePath, entry.line)}
                >
                  {entry.context}
                </span>
                <button
                  className="backlinks-linkify-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLinkify(entry);
                  }}
                  title="Convert to wikilink"
                >
                  Link
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

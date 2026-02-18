// §29 백링크 패널 — 현재 파일을 참조하는 다른 파일 목록
import { useEffect, useCallback } from "react";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useLinkStore } from "../../stores/link-store";
import { getBacklinks, refreshIndex } from "../../ipc/invoke";
import {
  groupBacklinksByFile,
  extractFileNameFromPath,
} from "./backlink-utils";

export function Backlinks() {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const rootPath = useFileStore((s) => s.rootPath);
  const { backlinks, loading, error, indexVersion, setBacklinks, setLoading, setError } =
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
      }
    })();

    return () => {
      cancelled = true;
    };
    // Only re-run when rootPath changes (full rebuild)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath]);

  // Fetch backlinks when active file changes or when index is updated (save)
  // IPC is fast (in-memory HashMap) so always refetch
  useEffect(() => {
    if (filePath) {
      fetchBacklinks(filePath);
    }
  }, [filePath, indexVersion, fetchBacklinks]);

  // Handle clicking a backlink entry → open that file and scroll to wikilink
  const handleClick = useCallback(
    (sourcePath: string) => {
      // Tell App.tsx to scroll to the wikilink referencing the current file
      if (filePath) {
        const stem = extractFileNameFromPath(filePath).replace(/\.md$/i, "");
        useLinkStore.getState().setPendingScrollTarget(stem);
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
          const { readFile } = await import("../../ipc/invoke");
          const content = await readFile(sourcePath);
          const fileName = extractFileNameFromPath(sourcePath);
          useFileStore.getState().setFileContent(sourcePath, content);
          openTab({
            id: crypto.randomUUID(),
            filePath: sourcePath,
            title: fileName,
            isDirty: false,
          });
        } catch (err) {
          console.error("[Backlinks] Failed to open file:", err);
        }
      })();
    },
    [],
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

  if (groups.length === 0) {
    return (
      <div className="backlinks-empty">
        No backlinks to{" "}
        <strong>{extractFileNameFromPath(filePath)}</strong>
      </div>
    );
  }

  return (
    <div className="backlinks">
      <div className="backlinks-header">
        Backlinks ({backlinks.length})
      </div>
      {groups.map((group) => (
        <div key={group.sourcePath} className="backlinks-group">
          <div
            className="backlinks-source"
            onClick={() => handleClick(group.sourcePath)}
          >
            {extractFileNameFromPath(group.sourcePath)}
          </div>
          {group.entries.map((entry, i) => (
            <div
              key={i}
              className="backlinks-context"
              onClick={() => handleClick(group.sourcePath)}
            >
              <span className="backlinks-line">L{entry.line}</span>
              <span className="backlinks-text">{entry.context}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

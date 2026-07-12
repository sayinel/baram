// §56c JournalTab — journal memories tab for MemoriesPanel
import { useCallback, useEffect } from "react";

import { readFile, writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import {
  extractDiarySection,
  extractOneLine,
  renderSimpleMarkdown,
  updateOneLineFrontmatter,
} from "../../utils/journal/journal-memories";
import { type MemoryEntry, OneLineEditor } from "./OneLineEditor";
import { resolveImageSrcs, resolveJournalBase } from "./utils";

export interface JournalTabProps {
  day: number;
  loading: boolean;
  memories: MemoryEntry[];
  mode: MemoriesMode;
  month: number;
  setLoading: (l: boolean) => void;
  setMemories: (m: MemoryEntry[]) => void;
  setMode: (m: MemoriesMode) => void;
}

export type MemoriesMode = "full" | "oneline";

export function JournalTab({
  memories,
  setMemories,
  mode,
  setMode,
  loading,
  setLoading,
  month,
  day,
}: JournalTabProps) {
  const { rootPath } = useFileStore();
  const { journalDirectory } = useSettingsStore();

  const loadMemories = useCallback(async () => {
    if (!rootPath || !journalDirectory) return;
    setLoading(true);

    try {
      const base = resolveJournalBase(rootPath, journalDirectory);
      const dailyDir = `${base}/daily`;
      const { listDir } = await import("../../ipc/invoke");
      const yearDirs = await listDir(dailyDir);
      const currentYear = new Date().getFullYear();
      const mm = String(month).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      const entries: MemoryEntry[] = [];

      for (const yearDir of yearDirs) {
        if (!yearDir.isDir) continue;
        const year = parseInt(yearDir.name, 10);
        if (isNaN(year)) continue;

        const filePath = `${dailyDir}/${year}/${mm}/${year}-${mm}-${dd}.md`;
        try {
          const content = await readFile(filePath);
          entries.push({
            year,
            path: filePath,
            oneLine: extractOneLine(content),
            diaryContent: extractDiarySection(content),
            fullContent: content,
            isCurrentYear: year === currentYear,
          });
        } catch {
          // File doesn't exist for this year — skip
        }
      }

      entries.sort((a, b) => b.year - a.year);
      setMemories(entries);
    } catch {
      // IPC not available or dir doesn't exist
    } finally {
      setLoading(false);
    }
  }, [rootPath, journalDirectory, month, day, setMemories, setLoading]);

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  const handleOpenEntry = (path: string) => {
    const { tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === path);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      readFile(path)
        .then((content) => {
          const fileName = path.split("/").pop() ?? "Unknown";
          useFileStore.getState().setFileContent(path, content);
          useEditorStore.getState().openTab({
            contextId: "",
            id: crypto.randomUUID(),
            filePath: path,
            title: fileName,
            isDirty: false,
            isPinned: false,
          });
        })
        .catch(() => {});
    }
  };

  return (
    <div className="memories-journal-tab">
      <div className="memories-mode-toggle">
        <button
          className={`memories-mode-btn ${mode === "oneline" ? "memories-mode-btn-active" : ""}`}
          onClick={() => setMode("oneline")}
        >
          One Line
        </button>
        <button
          className={`memories-mode-btn ${mode === "full" ? "memories-mode-btn-active" : ""}`}
          onClick={() => setMode("full")}
        >
          Full
        </button>
      </div>

      {loading && (
        <div aria-live="polite" className="memories-loading">
          Loading…
        </div>
      )}

      {!loading && memories.length === 0 && (
        <div className="memories-empty">이 날짜의 기록이 없습니다.</div>
      )}

      {memories.map((entry) => (
        <div
          className={`memories-year-card ${entry.isCurrentYear ? "memories-year-card-current" : ""}`}
          key={entry.year}
        >
          <div className="memories-year-card-header">
            <span className="memories-year-card-year">
              {entry.year}
              {entry.isCurrentYear && (
                <span className="memories-year-card-badge">오늘</span>
              )}
            </span>
            <button
              className="memories-year-card-open"
              onClick={() => handleOpenEntry(entry.path)}
              title="일기 열기"
            >
              <svg
                fill="none"
                height="14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="14"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" x2="21" y1="14" y2="3" />
              </svg>
            </button>
          </div>
          <div className="memories-year-card-body">
            {mode === "oneline" ? (
              entry.isCurrentYear ? (
                <OneLineEditor
                  entry={entry}
                  onSave={(newText) => {
                    const updated = updateOneLineFrontmatter(
                      entry.fullContent,
                      newText,
                    );
                    writeFile(entry.path, updated)
                      .then(() => {
                        setMemories(
                          memories.map((m) =>
                            m.year === entry.year
                              ? { ...m, oneLine: newText, fullContent: updated }
                              : m,
                          ),
                        );
                      })
                      .catch(() => {});
                  }}
                />
              ) : (
                <div
                  className="memories-oneline memories-md-render"
                  dangerouslySetInnerHTML={{
                    __html: resolveImageSrcs(
                      renderSimpleMarkdown(entry.oneLine) ||
                        "<p>(내용 없음)</p>",
                      entry.path.substring(0, entry.path.lastIndexOf("/")),
                    ),
                  }}
                />
              )
            ) : (
              <div
                className="memories-full memories-md-render"
                dangerouslySetInnerHTML={{
                  __html: resolveImageSrcs(
                    renderSimpleMarkdown(entry.diaryContent) ||
                      "<p>(내용 없음)</p>",
                    entry.path.substring(0, entry.path.lastIndexOf("/")),
                  ),
                }}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

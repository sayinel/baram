// §56c JournalTab — journal memories tab for MemoriesPanel
import { useCallback, useEffect } from "react";

import { useTranslation } from "../../i18n/useTranslation";
import { readFile, writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { subscribeJournalChanged } from "../../utils/journal/journal-events";
import {
  extractDiarySection,
  extractOneLine,
  renderSimpleMarkdown,
  updateOneLineFrontmatter,
} from "../../utils/journal/journal-memories";
import { basename } from "../../utils/path-utils";
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
  const { t } = useTranslation();
  const rootPath = useFileStore((s) => s.rootPath);
  const journalDirectory = useSettingsStore((s) => s.journalDirectory);

  /**
   * Fallback for an entry that renders to nothing.
   *
   * It is wrapped in a `<p>` because it goes through the same `dangerouslySetInnerHTML` as the
   * rendered markdown beside it. The text comes from our own locale files — no locale value
   * contains markup, and none is user input — so there is nothing here to escape.
   */
  const emptyRender = `<p>${t("journal.memories.emptyEntry")}</p>`;

  /**
   * Re-read every year's entry for the selected month/day.
   *
   * `silent` decides whether the loading placeholder takes the panel over while the reads are in
   * flight, and it must be set for a refresh that a save triggered. `.memories-loading` is a
   * block with 32px of padding above and below, so swapping the already-drawn year cards for it
   * and back — once per auto-save, while the user is typing — pushes the cards down ~90px and
   * back, which reads as the panel blinking. §56's real-time refresh reused this first-load path,
   * placeholder and all. On the first load and on date navigation there is nothing on screen
   * worth keeping, so the placeholder stays there.
   */
  const loadMemories = useCallback(
    async (silent = false) => {
      if (!rootPath || !journalDirectory) return;
      if (!silent) setLoading(true);

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
        if (!silent) setLoading(false);
      }
    },
    [rootPath, journalDirectory, month, day, setMemories, setLoading],
  );

  useEffect(() => {
    loadMemories();
  }, [loadMemories]);

  // §56 Refresh in real time when a journal entry is created/saved elsewhere
  // (e.g. editing today's entry in the main editor) instead of only on remount.
  useEffect(
    () => subscribeJournalChanged(() => void loadMemories(true)),
    [loadMemories],
  );

  const handleOpenEntry = (path: string) => {
    const { tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === path);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      readFile(path)
        .then((content) => {
          const fileName = basename(path);
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
          {t("journal.memories.mode.oneline")}
        </button>
        <button
          className={`memories-mode-btn ${mode === "full" ? "memories-mode-btn-active" : ""}`}
          onClick={() => setMode("full")}
        >
          {t("journal.memories.mode.full")}
        </button>
      </div>

      {loading && (
        <div aria-live="polite" className="memories-loading">
          {t("journal.loading")}
        </div>
      )}

      {!loading && memories.length === 0 && (
        <div className="memories-empty">{t("journal.memories.empty")}</div>
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
                <span className="memories-year-card-badge">
                  {t("journal.today")}
                </span>
              )}
            </span>
            <button
              className="memories-year-card-open"
              onClick={() => handleOpenEntry(entry.path)}
              title={t("journal.memories.open")}
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
                      renderSimpleMarkdown(entry.oneLine) || emptyRender,
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
                    renderSimpleMarkdown(entry.diaryContent) || emptyRender,
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

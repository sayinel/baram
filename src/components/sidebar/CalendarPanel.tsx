// §56 Calendar sidebar panel — mini calendar for journal navigation
import { useState, useEffect, useMemo, useCallback } from "react";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import {
  formatJournalDate,
  getMonthDays,
  getFirstDayOfWeek,
  getJournalFilePath,
  resolveJournalDir,
  generateDefaultJournal,
  applyJournalTemplate,
} from "../../utils/journal";
import { readFile, writeFile, createDir, listDir } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import type { FileEntry } from "../../stores/file-store";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function CalendarPanel() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const rootPath = useFileStore((s) => s.rootPath);
  const fileTree = useFileStore((s) => s.fileTree);

  const {
    journalEnabled,
    journalDirectory,
    journalFilenameFormat,
    journalTemplatePath,
  } = useSettingsStore();

  const resolvedDir = useMemo(
    () => resolveJournalDir(rootPath, journalDirectory),
    [rootPath, journalDirectory],
  );
  const isAbsoluteJournalDir = journalDirectory.startsWith("/") || /^[A-Z]:\\/.test(journalDirectory);

  // For absolute journal dirs (no rootPath needed), fetch files via IPC
  const [absoluteDirFiles, setAbsoluteDirFiles] = useState<string[]>([]);
  useEffect(() => {
    if (!journalEnabled || !isAbsoluteJournalDir || !resolvedDir) return;
    let cancelled = false;
    (async () => {
      try {
        const entries = await listDir(resolvedDir, false);
        if (!cancelled) {
          setAbsoluteDirFiles(entries.filter((e) => !e.isDir).map((e) => e.name));
        }
      } catch {
        // Directory may not exist yet
        if (!cancelled) setAbsoluteDirFiles([]);
      }
    })();
    return () => { cancelled = true; };
  }, [journalEnabled, isAbsoluteJournalDir, resolvedDir, viewYear, viewMonth]);

  // Scan fileTree for existing journal files → Set of "YYYY-MM-DD" strings
  const journalDates = useMemo(() => {
    const dates = new Set<string>();
    if (!journalEnabled) return dates;

    // For absolute path: use IPC-fetched file list
    if (isAbsoluteJournalDir) {
      for (const filename of absoluteDirFiles) {
        const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/) ||
                      filename.match(/^(\d{4})(\d{2})(\d{2})\.md$/);
        if (match) {
          dates.add(`${match[1]}-${match[2]}-${match[3]}`);
        }
      }
      return dates;
    }

    // For relative path: scan fileTree
    if (!fileTree) return dates;
    const dir = journalDirectory.replace(/^\/+|\/+$/g, "");

    const scanEntries = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (entry.children) {
          scanEntries(entry.children);
        } else if (entry.path) {
          // Check if this file is in the journal directory
          const rel = rootPath ? entry.path.replace(rootPath + "/", "") : entry.path;
          if (rel.startsWith(dir + "/")) {
            const filename = rel.slice(dir.length + 1);
            // Extract date from filename (try both formats)
            const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/) ||
                          filename.match(/^(\d{4})(\d{2})(\d{2})\.md$/);
            if (match) {
              dates.add(`${match[1]}-${match[2]}-${match[3]}`);
            }
          }
        }
      }
    };
    scanEntries(fileTree);
    return dates;
  }, [fileTree, journalEnabled, journalDirectory, rootPath, isAbsoluteJournalDir, absoluteDirFiles]);

  const days = useMemo(() => getMonthDays(viewYear, viewMonth), [viewYear, viewMonth]);
  const firstDow = useMemo(() => getFirstDayOfWeek(viewYear, viewMonth), [viewYear, viewMonth]);
  const todayStr = formatJournalDate(today);

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }, [viewMonth]);

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }, [viewMonth]);

  const goToday = useCallback(() => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
  }, [today]);

  const openOrCreateJournal = useCallback(async (date: Date) => {
    if (!journalEnabled || !resolvedDir) return;
    const journalPath = getJournalFilePath(
      rootPath,
      journalDirectory,
      date,
      journalFilenameFormat,
    );
    if (!journalPath) return;

    // Check if file exists
    let exists = true;
    try {
      await readFile(journalPath);
    } catch {
      exists = false;
    }

    if (!exists) {
      // Create the journal file
      await createDir(resolvedDir);

      let content: string;
      if (journalTemplatePath) {
        try {
          const tpl = await readFile(journalTemplatePath);
          content = applyJournalTemplate(tpl, date);
        } catch {
          content = generateDefaultJournal(date);
        }
      } else {
        content = generateDefaultJournal(date);
      }
      await writeFile(journalPath, content);
    }

    // Open the file
    const { tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === journalPath);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      try {
        const content = await readFile(journalPath);
        const fileName = journalPath.split("/").pop() ?? "Unknown";
        useFileStore.getState().setFileContent(journalPath, content);
        useEditorStore.getState().openTab({
          id: crypto.randomUUID(),
          filePath: journalPath,
          title: fileName,
          isDirty: false,
          isPinned: false,
        });
      } catch (err) {
        console.error("[CalendarPanel] Failed to open journal:", err);
      }
    }
  }, [rootPath, resolvedDir, journalEnabled, journalDirectory, journalFilenameFormat, journalTemplatePath]);

  if (!journalEnabled) {
    return (
      <div className="calendar-panel">
        <div className="calendar-empty">
          Journal is disabled. Enable it in Settings &gt; General &gt; Journal.
        </div>
      </div>
    );
  }

  // Build grid cells: leading empty cells + days
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDow; i++) {
    cells.push(null);
  }
  for (const d of days) {
    cells.push(d);
  }

  return (
    <div className="calendar-panel">
      <div className="calendar-header">
        <button className="calendar-nav-btn" onClick={prevMonth} title="Previous month">
          &lt;
        </button>
        <button className="calendar-title" onClick={goToday} title="Go to today">
          {MONTH_NAMES[viewMonth]} {viewYear}
        </button>
        <button className="calendar-nav-btn" onClick={nextMonth} title="Next month">
          &gt;
        </button>
      </div>
      <div className="calendar-grid">
        {DAY_NAMES.map((d) => (
          <div key={d} className="calendar-day-name">{d}</div>
        ))}
        {cells.map((date, i) => {
          if (!date) {
            return <div key={`empty-${i}`} className="calendar-cell calendar-cell-empty" />;
          }
          const dateStr = formatJournalDate(date);
          const isToday = dateStr === todayStr;
          const hasJournal = journalDates.has(dateStr);
          return (
            <button
              key={dateStr}
              className={`calendar-cell${isToday ? " calendar-cell-today" : ""}${hasJournal ? " calendar-cell-has-journal" : ""}`}
              onClick={() => openOrCreateJournal(date)}
              title={dateStr}
            >
              {date.getDate()}
              {hasJournal && <span className="calendar-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

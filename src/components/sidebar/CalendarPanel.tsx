// §56 Calendar sidebar panel — mini calendar for journal navigation
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { getJournalTheme } from "../../utils/journal-themes";
import {
  formatJournalDate,
  getMonthDays,
  getFirstDayOfWeek,
  getJournalFilePath,
  getHierarchicalJournalPath,
  getWeeklyJournalPath,
  getMonthlyJournalPath,
  getYearlyJournalPath,
  getISOWeekNumber,
  resolveJournalDir,
  generateDefaultJournal,
  applyJournalTemplate,
} from "../../utils/journal";
import {
  generateDefaultWeekly,
  generateDefaultMonthly,
  generateDefaultYearly,
} from "../../utils/journal-periodic";
import { parseMoodFromFrontmatter, getMoodColors } from "../../utils/journal-mood";
import type { MoodValue } from "../../utils/journal-mood";
import { readFile, writeFile, createDir, listDir } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { YearInPixels } from "../journal/YearInPixels";
import { MoodTrend30 } from "../journal/MoodTrend30";
import { StatsPanel } from "../journal/StatsPanel";
import { DailyPrompt } from "../journal/DailyPrompt";
import { JournalSearchPanel } from "../journal/JournalSearchPanel";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function CalendarPanel() {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [showSearch, setShowSearch] = useState(false);

  const {
    journalEnabled,
    journalDirectory,
    journalFilenameFormat,
    journalTemplatePath,
    journalUseHierarchy,
    journalWeeklyEnabled,
    journalMonthlyEnabled,
    journalYearlyEnabled,
    journalThemeId,
    theme,
  } = useSettingsStore();

  const journalTheme = useMemo(() => getJournalTheme(journalThemeId), [journalThemeId]);

  const resolvedDir = useMemo(
    () => resolveJournalDir(null, journalDirectory),
    [journalDirectory],
  );

  // §56e Mood colors — theme-aware palette
  const effectiveBase = useMemo<"light" | "dark">(() => {
    if (theme === "light" || theme === "dark") return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }, [theme]);
  const MOOD_COLORS = useMemo(() => getMoodColors(effectiveBase), [effectiveBase]);

  // Fetch journal files via IPC — supports both flat and hierarchical layouts
  const [dirFiles, setDirFiles] = useState<string[]>([]);
  const [moodMap, setMoodMap] = useState<Map<string, MoodValue>>(new Map());
  useEffect(() => {
    if (!journalEnabled || !resolvedDir) return;
    let cancelled = false;
    (async () => {
      try {
        let fileEntries: { name: string; path: string }[];
        if (journalUseHierarchy) {
          const dailyDir = `${resolvedDir}/daily`;
          const entries = await listDir(dailyDir, true);
          fileEntries = entries.filter((e) => !e.isDir).map((e) => ({ name: e.name, path: e.path }));
        } else {
          const entries = await listDir(resolvedDir, false);
          fileEntries = entries.filter((e) => !e.isDir).map((e) => ({ name: e.name, path: e.path }));
        }
        if (cancelled) return;
        setDirFiles(fileEntries.map((e) => e.name));

        // Read frontmatter for mood colors (batch, non-blocking)
        const moods = new Map<string, MoodValue>();
        const reads = fileEntries.slice(0, 62).map(async (entry) => {
          const match = entry.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/) ||
                        entry.name.match(/^(\d{4})(\d{2})(\d{2})\.md$/);
          if (!match) return;
          const dateStr = `${match[1]}-${match[2]}-${match[3]}`;
          try {
            const content = await readFile(entry.path);
            const mood = parseMoodFromFrontmatter(content);
            if (mood) moods.set(dateStr, mood);
          } catch { /* skip unreadable files */ }
        });
        await Promise.all(reads);
        if (!cancelled) setMoodMap(moods);
      } catch {
        if (!cancelled) { setDirFiles([]); setMoodMap(new Map()); }
      }
    })();
    return () => { cancelled = true; };
  }, [journalEnabled, resolvedDir, journalUseHierarchy, viewYear, viewMonth]);

  // Extract "YYYY-MM-DD" date strings from filenames
  const journalDates = useMemo(() => {
    const dates = new Set<string>();
    if (!journalEnabled) return dates;
    for (const filename of dirFiles) {
      const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/) ||
                    filename.match(/^(\d{4})(\d{2})(\d{2})\.md$/);
      if (match) {
        dates.add(`${match[1]}-${match[2]}-${match[3]}`);
      }
    }
    return dates;
  }, [journalEnabled, dirFiles]);

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
    const journalPath = journalUseHierarchy
      ? getHierarchicalJournalPath(resolvedDir, date, journalFilenameFormat)
      : getJournalFilePath(null, journalDirectory, date, journalFilenameFormat);
    if (!journalPath) return;

    // Check if file exists
    let exists = true;
    try {
      await readFile(journalPath);
    } catch {
      exists = false;
    }

    if (!exists) {
      // Create the journal file (and parent dirs for hierarchical layout)
      const parentDir = journalPath.substring(0, journalPath.lastIndexOf("/"));
      await createDir(parentDir);

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
  }, [resolvedDir, journalEnabled, journalDirectory, journalFilenameFormat, journalTemplatePath, journalUseHierarchy]);

  // §56f Open or create periodic notes
  const openPeriodicNote = useCallback(async (
    getPath: (dir: string, date: Date) => string,
    generate: (date: Date) => string,
    date: Date,
  ) => {
    if (!journalEnabled || !resolvedDir) return;
    const notePath = getPath(resolvedDir, date);
    const parentDir = notePath.substring(0, notePath.lastIndexOf("/"));
    await createDir(parentDir).catch(() => {});

    let content: string;
    try {
      content = await readFile(notePath);
    } catch {
      content = generate(date);
      await writeFile(notePath, content);
    }

    const { tabs } = useEditorStore.getState();
    const existing = tabs.find((t) => t.filePath === notePath);
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
    } else {
      useFileStore.getState().setFileContent(notePath, content);
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        filePath: notePath,
        title: notePath.split("/").pop() ?? "Note",
        isDirty: false,
        isPinned: false,
      });
    }
  }, [resolvedDir, journalEnabled]);

  const openWeeklyNote = useCallback((date: Date) => {
    openPeriodicNote(getWeeklyJournalPath, generateDefaultWeekly, date);
  }, [openPeriodicNote]);

  const openMonthlyNote = useCallback(() => {
    const date = new Date(viewYear, viewMonth, 1);
    openPeriodicNote(getMonthlyJournalPath, generateDefaultMonthly, date);
  }, [openPeriodicNote, viewYear, viewMonth]);

  const openYearlyNote = useCallback(() => {
    const date = new Date(viewYear, 0, 1);
    openPeriodicNote(getYearlyJournalPath, generateDefaultYearly, date);
  }, [openPeriodicNote, viewYear]);

  const themeStyle: React.CSSProperties | undefined = journalTheme.id !== "default" ? {
    "--cal-accent": journalTheme.accentColor,
    "--cal-header": journalTheme.headerColor,
  } as React.CSSProperties : undefined;

  if (!journalEnabled) {
    return (
      <div className="calendar-panel" style={themeStyle}>
        <div className="calendar-empty">
          Journal is disabled. Enable it in Settings &gt; General &gt; Journal.
        </div>
      </div>
    );
  }

  if (!resolvedDir) {
    return (
      <div className="calendar-panel" style={themeStyle}>
        <div className="calendar-empty">
          Set the journal directory in Settings &gt; General &gt; Journal.
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

  // §56f Build rows with optional week numbers
  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }

  return (
    <div className="calendar-panel" style={themeStyle}>
      <div className="calendar-header">
        <button className="calendar-nav-btn" onClick={prevMonth} title="Previous month">
          &lt;
        </button>
        <span className="calendar-title-group">
          {journalMonthlyEnabled ? (
            <button
              className="calendar-title calendar-title-month"
              onClick={openMonthlyNote}
              title={`Open ${MONTH_NAMES[viewMonth]} note`}
            >
              {MONTH_NAMES[viewMonth]}
            </button>
          ) : (
            <button className="calendar-title" onClick={goToday} title="Go to today">
              {MONTH_NAMES[viewMonth]}
            </button>
          )}
          {" "}
          {journalYearlyEnabled ? (
            <button
              className="calendar-title calendar-title-year"
              onClick={openYearlyNote}
              title={`Open ${viewYear} yearly note`}
            >
              {viewYear}
            </button>
          ) : (
            <button className="calendar-title" onClick={goToday} title="Go to today">
              {viewYear}
            </button>
          )}
        </span>
        <button className="calendar-nav-btn" onClick={nextMonth} title="Next month">
          &gt;
        </button>
        <button
          className={`calendar-nav-btn calendar-search-btn${showSearch ? " calendar-search-btn-active" : ""}`}
          onClick={() => setShowSearch((v) => !v)}
          title="Search journal"
          aria-label="Toggle journal search"
        >
          &#128269;
        </button>
      </div>
      <div className={`calendar-grid${journalWeeklyEnabled ? " calendar-grid-with-weeks" : ""}`}>
        {journalWeeklyEnabled && <div className="calendar-week-header">W</div>}
        {DAY_NAMES.map((d) => (
          <div key={d} className="calendar-day-name">{d}</div>
        ))}
        {rows.map((row, rowIdx) => {
          // Find the first real date in this row for week number
          const firstDate = row.find((d) => d !== null);
          const weekNum = firstDate ? getISOWeekNumber(firstDate) : null;
          return (
            <React.Fragment key={`row-${rowIdx}`}>
              {journalWeeklyEnabled && (
                <button
                  className="calendar-week-num"
                  onClick={() => firstDate && openWeeklyNote(firstDate)}
                  title={weekNum !== null ? `Open W${String(weekNum).padStart(2, "0")} note` : undefined}
                  disabled={!firstDate}
                >
                  {weekNum !== null ? weekNum : ""}
                </button>
              )}
              {row.map((date, cellIdx) => {
                if (!date) {
                  return <div key={`empty-${rowIdx}-${cellIdx}`} className="calendar-cell calendar-cell-empty" />;
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
                    {hasJournal && (
                      <span
                        className="calendar-dot"
                        style={moodMap.has(dateStr) ? { background: MOOD_COLORS[moodMap.get(dateStr)!] } : undefined}
                      />
                    )}
                  </button>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
      {showSearch && (
        <JournalSearchPanel onClose={() => setShowSearch(false)} />
      )}
      <StatsPanel journalDates={journalDates} />
      <DailyPrompt />
      <MoodTrend30 moodMap={moodMap} />
      <YearInPixels journalDir={resolvedDir} year={viewYear} useHierarchy={journalUseHierarchy} />
    </div>
  );
}

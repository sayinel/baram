// §56 Calendar sidebar panel — mini calendar for journal navigation
import React, { useCallback, useEffect, useMemo, useState } from "react";

import type { MoodValue } from "../../utils/journal-mood";

import { useShallow } from "zustand/shallow";

import { createDir, listDir, readFile, writeFile } from "../../ipc/invoke";
import {
  ensureJournalFile,
  openFileInTab,
} from "../../services/journal-file-service";
import { useAIStore } from "../../stores/ai-store";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import {
  formatJournalDate,
  getFirstDayOfWeek,
  getISOWeekNumber,
  getMonthDays,
  getWeeklyJournalPath,
  resolveJournalDir,
} from "../../utils/journal";
import {
  getMoodColors,
  parseMoodFromFrontmatter,
} from "../../utils/journal-mood";
import {
  applyPeriodicTemplate,
  generateDefaultWeekly,
} from "../../utils/journal-periodic";
import { getJournalTheme } from "../../utils/journal-themes";
import { logger } from "../../utils/logger";
import { JournalSearchPanel } from "../journal/JournalSearchPanel";
import { MoodTrend30 } from "../journal/MoodTrend30";
import { ReflectionPanel } from "../journal/ReflectionPanel";
import { StatsPanel } from "../journal/StatsPanel";
import { YearInPixels } from "../journal/YearInPixels";

const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const JOURNAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})\.md$/;
const JOURNAL_DATE_COMPACT_RE = /^(\d{4})(\d{2})(\d{2})\.md$/;

export function CalendarPanel() {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [calView, setCalView] = useState<"days" | "months" | "years">("days");
  const [showSearch, setShowSearch] = useState(false);
  const [showReflection, setShowReflection] = useState(false);

  const { provider, apiKey } = useAIStore(
    useShallow((s) => ({ provider: s.provider, apiKey: s.apiKey })),
  );

  const {
    journalEnabled,
    journalDirectory,
    journalFilenameFormat,
    journalTemplatePath,
    journalUseHierarchy,
    journalWeeklyEnabled,
    journalWeeklyTemplate,
    journalThemeId,
    theme,
  } = useSettingsStore(
    useShallow((s) => ({
      journalEnabled: s.journalEnabled,
      journalDirectory: s.journalDirectory,
      journalFilenameFormat: s.journalFilenameFormat,
      journalTemplatePath: s.journalTemplatePath,
      journalUseHierarchy: s.journalUseHierarchy,
      journalWeeklyEnabled: s.journalWeeklyEnabled,
      journalWeeklyTemplate: s.journalWeeklyTemplate,
      journalThemeId: s.journalThemeId,
      theme: s.theme,
    })),
  );

  const journalTheme = useMemo(
    () => getJournalTheme(journalThemeId),
    [journalThemeId],
  );

  const resolvedDir = useMemo(
    () => resolveJournalDir(null, journalDirectory),
    [journalDirectory],
  );

  // §56e Mood colors — theme-aware palette
  const effectiveBase = useMemo<"dark" | "light">(() => {
    if (theme === "light" || theme === "dark") return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }, [theme]);
  const MOOD_COLORS = useMemo(
    () => getMoodColors(effectiveBase),
    [effectiveBase],
  );

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
          fileEntries = entries
            .filter((e) => !e.isDir)
            .map((e) => ({ name: e.name, path: e.path }));
        } else {
          const entries = await listDir(resolvedDir, false);
          fileEntries = entries
            .filter((e) => !e.isDir)
            .map((e) => ({ name: e.name, path: e.path }));
        }
        if (cancelled) return;
        setDirFiles(fileEntries.map((e) => e.name));

        // Read frontmatter for mood colors (batch, non-blocking)
        const moods = new Map<string, MoodValue>();
        const reads = fileEntries.slice(0, 62).map(async (entry) => {
          const match =
            entry.name.match(JOURNAL_DATE_RE) ||
            entry.name.match(JOURNAL_DATE_COMPACT_RE);
          if (!match) return;
          const dateStr = `${match[1]}-${match[2]}-${match[3]}`;
          try {
            const content = await readFile(entry.path);
            const mood = parseMoodFromFrontmatter(content);
            if (mood) moods.set(dateStr, mood);
          } catch {
            /* skip unreadable files */
          }
        });
        await Promise.all(reads);
        if (!cancelled) setMoodMap(moods);
      } catch {
        if (!cancelled) {
          setDirFiles([]);
          setMoodMap(new Map());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [journalEnabled, resolvedDir, journalUseHierarchy, viewYear, viewMonth]);

  // Extract "YYYY-MM-DD" date strings from filenames
  const journalDates = useMemo(() => {
    const dates = new Set<string>();
    if (!journalEnabled) return dates;
    for (const filename of dirFiles) {
      const match =
        filename.match(JOURNAL_DATE_RE) ||
        filename.match(JOURNAL_DATE_COMPACT_RE);
      if (match) {
        dates.add(`${match[1]}-${match[2]}-${match[3]}`);
      }
    }
    return dates;
  }, [journalEnabled, dirFiles]);

  const days = useMemo(
    () => getMonthDays(viewYear, viewMonth),
    [viewYear, viewMonth],
  );
  const firstDow = useMemo(
    () => getFirstDayOfWeek(viewYear, viewMonth),
    [viewYear, viewMonth],
  );
  const todayStr = formatJournalDate(today);

  const yearRangeStart = viewYear - (viewYear % 12);

  const navPrev = useCallback(() => {
    if (calView === "days") {
      if (viewMonth === 0) {
        setViewYear((y) => y - 1);
        setViewMonth(11);
      } else setViewMonth((m) => m - 1);
    } else if (calView === "months") {
      setViewYear((y) => y - 1);
    } else {
      setViewYear((y) => y - 12);
    }
  }, [viewMonth, calView]);

  const navNext = useCallback(() => {
    if (calView === "days") {
      if (viewMonth === 11) {
        setViewYear((y) => y + 1);
        setViewMonth(0);
      } else setViewMonth((m) => m + 1);
    } else if (calView === "months") {
      setViewYear((y) => y + 1);
    } else {
      setViewYear((y) => y + 12);
    }
  }, [viewMonth, calView]);

  const openOrCreateJournal = useCallback(
    async (date: Date) => {
      if (!journalEnabled || !resolvedDir) return;
      try {
        const result = await ensureJournalFile(date, {
          journalDirectory,
          journalFilenameFormat,
          journalTemplatePath,
          journalUseHierarchy,
          rootPath: null,
        });
        if (!result) return;
        await openFileInTab(result.path, result.content);
      } catch (err) {
        logger.error("[CalendarPanel] Failed to open journal:", err);
      }
    },
    [
      resolvedDir,
      journalEnabled,
      journalDirectory,
      journalFilenameFormat,
      journalTemplatePath,
      journalUseHierarchy,
    ],
  );

  // §56f / §56a Open or create periodic notes
  const openPeriodicNote = useCallback(
    async (
      getPath: (dir: string, date: Date) => string,
      generate: (date: Date) => string,
      date: Date,
      templatePath?: string,
    ) => {
      if (!journalEnabled || !resolvedDir) return;
      const notePath = getPath(resolvedDir, date);
      const parentDir = notePath.substring(0, notePath.lastIndexOf("/"));
      await createDir(parentDir).catch(() => {});

      let content: string;
      try {
        content = await readFile(notePath);
      } catch {
        // New file — apply template or fallback to default generator
        if (templatePath) {
          try {
            const tpl = await readFile(templatePath);
            content = applyPeriodicTemplate(tpl, date);
          } catch {
            content = generate(date);
          }
        } else {
          content = generate(date);
        }
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
    },
    [resolvedDir, journalEnabled],
  );

  const openWeeklyNote = useCallback(
    (date: Date) => {
      openPeriodicNote(
        getWeeklyJournalPath,
        generateDefaultWeekly,
        date,
        journalWeeklyTemplate || undefined,
      );
    },
    [openPeriodicNote, journalWeeklyTemplate],
  );

  const themeStyle: React.CSSProperties = {
    "--cal-accent": journalTheme.accentColor,
    "--cal-header": journalTheme.headerColor,
    "--journal-font-family": journalTheme.typography.fontFamily,
    "--journal-line-height": String(journalTheme.typography.lineHeight),
    "--journal-max-width": journalTheme.typography.maxWidth,
    "--journal-header-bg": journalTheme.headerBg,
    "--journal-prompt-bg": journalTheme.promptBg,
    "--journal-prompt-border": journalTheme.promptBorder,
  } as React.CSSProperties;

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
        <button className="calendar-nav-btn" onClick={navPrev} title="Previous">
          &lt;
        </button>
        <span className="calendar-title-group">
          {calView === "days" && (
            <>
              <button
                className="calendar-title calendar-title-month"
                onClick={() => setCalView("months")}
                title="Select month"
              >
                {MONTH_NAMES[viewMonth]}
              </button>{" "}
              <button
                className="calendar-title calendar-title-year"
                onClick={() => setCalView("years")}
                title="Select year"
              >
                {viewYear}
              </button>
            </>
          )}
          {calView === "months" && (
            <button
              className="calendar-title calendar-title-year"
              onClick={() => setCalView("years")}
              title="Select year"
            >
              {viewYear}
            </button>
          )}
          {calView === "years" && (
            <span className="calendar-title">
              {yearRangeStart}–{yearRangeStart + 11}
            </span>
          )}
        </span>
        <button className="calendar-nav-btn" onClick={navNext} title="Next">
          &gt;
        </button>
        <button
          aria-label="Toggle journal search"
          className={`calendar-nav-btn calendar-search-btn${showSearch ? "calendar-search-btn-active" : ""}`}
          onClick={() => setShowSearch((v) => !v)}
          title="Search journal"
        >
          &#128269;
        </button>
        {(provider === "ollama" || (apiKey && apiKey.length > 0)) && (
          <button
            aria-label="Toggle AI reflection"
            className={`calendar-nav-btn calendar-reflection-btn${showReflection ? "calendar-reflection-btn-active" : ""}`}
            onClick={() => setShowReflection((v) => !v)}
            title="AI Reflection"
          >
            ✨
          </button>
        )}
      </div>
      {calView === "days" && (
        <div
          className={`calendar-grid${journalWeeklyEnabled ? "calendar-grid-with-weeks" : ""}`}
        >
          {journalWeeklyEnabled && (
            <div className="calendar-week-header">W</div>
          )}
          {DAY_NAMES.map((d) => (
            <div className="calendar-day-name" key={d}>
              {d}
            </div>
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
                    disabled={!firstDate}
                    onClick={() => firstDate && openWeeklyNote(firstDate)}
                    title={
                      weekNum !== null
                        ? `Open W${String(weekNum).padStart(2, "0")} note`
                        : undefined
                    }
                  >
                    {weekNum !== null ? weekNum : ""}
                  </button>
                )}
                {row.map((date, cellIdx) => {
                  if (!date) {
                    return (
                      <div
                        className="calendar-cell calendar-cell-empty"
                        key={`empty-${rowIdx}-${cellIdx}`}
                      />
                    );
                  }
                  const dateStr = formatJournalDate(date);
                  const isToday = dateStr === todayStr;
                  const hasJournal = journalDates.has(dateStr);
                  return (
                    <button
                      className={`calendar-cell${isToday ? "calendar-cell-today" : ""}${hasJournal ? "calendar-cell-has-journal" : ""}`}
                      key={dateStr}
                      onClick={() => openOrCreateJournal(date)}
                      title={dateStr}
                    >
                      {date.getDate()}
                      {hasJournal && (
                        <span
                          className="calendar-dot"
                          style={
                            moodMap.has(dateStr)
                              ? {
                                  background:
                                    MOOD_COLORS[moodMap.get(dateStr)!],
                                }
                              : undefined
                          }
                        />
                      )}
                    </button>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      )}
      {calView === "months" && (
        <div className="calendar-picker calendar-months-picker">
          {MONTH_NAMES.map((name, idx) => (
            <button
              className={`calendar-pick-btn${idx === viewMonth ? "calendar-pick-btn-selected" : ""}${idx === today.getMonth() && viewYear === today.getFullYear() ? "calendar-pick-btn-today" : ""}`}
              key={name}
              onClick={() => {
                setViewMonth(idx);
                setCalView("days");
              }}
            >
              {name.slice(0, 3)}
            </button>
          ))}
        </div>
      )}
      {calView === "years" && (
        <div className="calendar-picker calendar-years-picker">
          {Array.from({ length: 12 }, (_, i) => yearRangeStart + i).map(
            (yr) => (
              <button
                className={`calendar-pick-btn${yr === viewYear ? "calendar-pick-btn-selected" : ""}${yr === today.getFullYear() ? "calendar-pick-btn-today" : ""}`}
                key={yr}
                onClick={() => {
                  setViewYear(yr);
                  setCalView("months");
                }}
              >
                {yr}
              </button>
            ),
          )}
        </div>
      )}
      {showSearch && (
        <JournalSearchPanel onClose={() => setShowSearch(false)} />
      )}
      {showReflection && (
        <ReflectionPanel onClose={() => setShowReflection(false)} />
      )}
      <StatsPanel journalDates={journalDates} />
      <MoodTrend30 moodMap={moodMap} />
      <YearInPixels
        journalDir={resolvedDir}
        useHierarchy={journalUseHierarchy}
        year={viewYear}
      />
    </div>
  );
}

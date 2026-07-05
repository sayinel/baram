// §56 Calendar sidebar panel — mini calendar for journal navigation
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { useShallow } from "zustand/shallow";

import { createDir, listDir, readFile, writeFile } from "../../ipc/invoke";
import {
  ensureJournalFile,
  openFileInTab,
} from "../../services/journal-file-service";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useJournalLayoutStore } from "../../stores/ui/journal-layout";
import {
  formatJournalDate,
  getFirstDayOfWeek,
  getISOWeekNumber,
  getMonthDays,
  getWeeklyJournalPath,
  JOURNAL_DATE_PARTS_RE,
  JOURNAL_FILENAME_COMPACT_RE,
  resolveJournalDir,
} from "../../utils/journal/journal";
import {
  applyPeriodicTemplate,
  generateDefaultWeekly,
} from "../../utils/journal/journal-periodic";
import { getJournalTheme } from "../../utils/journal/journal-themes";
import { logger } from "../../utils/logger";
import { JournalSearchPanel } from "../journal/JournalSearchPanel";
import { JournalSection } from "../journal/JournalSection";
import { StatsPanel } from "../journal/StatsPanel";

const SEARCH_SECTION = "journal-search";
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

export function CalendarPanel() {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [calView, setCalView] = useState<"days" | "months" | "years">("days");
  const searchCollapsed = useJournalLayoutStore(
    (s) => s.collapsed[SEARCH_SECTION] ?? true,
  );
  const toggleSection = useJournalLayoutStore((s) => s.toggle);
  const setSectionCollapsed = useJournalLayoutStore((s) => s.setCollapsed);

  const {
    journalEnabled,
    journalDirectory,
    journalFilenameFormat,
    journalTemplatePath,
    journalUseHierarchy,
    journalWeeklyEnabled,
    journalWeeklyTemplate,
    journalThemeId,
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

  // Fetch journal files via IPC — supports both flat and hierarchical layouts
  const [dirFiles, setDirFiles] = useState<string[]>([]);
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
      } catch {
        if (!cancelled) {
          setDirFiles([]);
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
      const matchStd = filename.match(JOURNAL_DATE_PARTS_RE);
      if (matchStd) {
        dates.add(`${matchStd[1]}-${matchStd[2]}-${matchStd[3]}`);
      } else if (JOURNAL_FILENAME_COMPACT_RE.test(filename)) {
        dates.add(
          `${filename.slice(0, 4)}-${filename.slice(4, 6)}-${filename.slice(6, 8)}`,
        );
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
          contextId: "",
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
              </button>
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
          className={[
            "calendar-nav-btn calendar-search-btn",
            !searchCollapsed && "calendar-search-btn-active",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => toggleSection(SEARCH_SECTION, true)}
          title="Search journal"
        >
          &#128269;
        </button>
      </div>
      {calView === "days" && (
        <div
          className={[
            "calendar-grid",
            journalWeeklyEnabled && "calendar-grid-with-weeks",
          ]
            .filter(Boolean)
            .join(" ")}
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
                      className={[
                        "calendar-cell",
                        isToday && "calendar-cell-today",
                        hasJournal && "calendar-cell-has-journal",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={dateStr}
                      onClick={() => openOrCreateJournal(date)}
                      title={dateStr}
                    >
                      <span
                        className={[
                          "calendar-dot",
                          hasJournal && "calendar-dot-filled",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      />
                      {date.getDate()}
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
              className={[
                "calendar-pick-btn",
                idx === viewMonth && "calendar-pick-btn-selected",
                idx === today.getMonth() &&
                  viewYear === today.getFullYear() &&
                  "calendar-pick-btn-today",
              ]
                .filter(Boolean)
                .join(" ")}
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
                className={[
                  "calendar-pick-btn",
                  yr === viewYear && "calendar-pick-btn-selected",
                  yr === today.getFullYear() && "calendar-pick-btn-today",
                ]
                  .filter(Boolean)
                  .join(" ")}
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
      <JournalSection defaultCollapsed id={SEARCH_SECTION} title="검색">
        <JournalSearchPanel
          onClose={() => setSectionCollapsed(SEARCH_SECTION, true)}
        />
      </JournalSection>
      <StatsPanel journalDates={journalDates} />
    </div>
  );
}

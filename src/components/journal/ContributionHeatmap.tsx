// §56g Contribution Heatmap — GitHub-style 12-month grid
import { useMemo, useState } from "react";

import { INTL_LOCALES } from "../../i18n";
import { monthShortNames, weekdayShortNames } from "../../i18n/date-names";
import { useTranslation } from "../../i18n/useTranslation";
import { useEditorStore } from "../../stores/editor/editor";

export interface HeatmapEntry {
  date: string; // YYYY-MM-DD
  wordCount: number;
}

interface ContributionHeatmapProps {
  entries: HeatmapEntry[];
  onDateClick?: (date: string) => void;
  year: number;
}

export function ContributionHeatmap({
  entries,
  year,
  onDateClick,
}: ContributionHeatmapProps) {
  const { locale, t } = useTranslation();
  const intl = INTL_LOCALES[locale];
  const [tooltip, setTooltip] = useState<null | {
    date: string;
    wordCount: number;
    x: number;
    y: number;
  }>(null);

  const wordCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(e.date, e.wordCount);
    }
    return map;
  }, [entries]);

  const cells = useMemo(() => getWeekColumns(year), [year]);
  const monthLabels = useMemo(() => getMonthLabels(year, intl), [year, intl]);
  const dayLabels = useMemo(() => weekdayShortNames(intl), [intl]);

  // Max weekIndex to size the grid
  const maxWeek = useMemo(() => {
    let max = 0;
    for (const c of cells) if (c.weekIndex > max) max = c.weekIndex;
    return max;
  }, [cells]);

  const totalWeeks = maxWeek + 1; // 53 or 54

  const handleCellClick = (date: string) => {
    if (onDateClick) {
      onDateClick(date);
    } else {
      // Default: open the journal file for this date
      openJournalDate(date);
    }
  };

  return (
    <>
      <div
        className="contribution-heatmap"
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Month labels row */}
        <div
          className="contribution-heatmap-month-labels"
          style={{ paddingLeft: 28 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${totalWeeks}, 10px)`,
              gap: "2px",
              position: "relative",
              height: 14,
            }}
          >
            {monthLabels.map(({ month, weekIndex }, i) => (
              <div
                className="contribution-heatmap-month"
                key={i}
                style={{ gridColumn: weekIndex + 1, gridRow: 1 }}
              >
                {month}
              </div>
            ))}
          </div>
        </div>

        {/* Main grid: day labels + cells */}
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          {/* Day-of-week labels (Sunday first, matching `Date.getDay()` order) */}
          <div className="contribution-heatmap-day-labels">
            {dayLabels.map((label, dow) => (
              <div className="contribution-heatmap-day-label" key={dow}>
                {label}
              </div>
            ))}
          </div>

          {/* Heatmap grid */}
          <div
            className="contribution-heatmap-grid"
            style={{ gridTemplateColumns: `repeat(${totalWeeks}, 10px)` }}
          >
            {cells.map(({ date, dayOfWeek, weekIndex }) => {
              const wc = wordCountMap.get(date) ?? 0;
              const level = getHeatmapLevel(wc);
              return (
                <div
                  className="contribution-heatmap-cell"
                  data-level={level}
                  key={date}
                  onClick={() => handleCellClick(date)}
                  onMouseEnter={(e) => {
                    const rect = (
                      e.target as HTMLElement
                    ).getBoundingClientRect();
                    setTooltip({
                      date,
                      wordCount: wc,
                      x: rect.left + rect.width / 2,
                      y: rect.top,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                  style={{
                    gridColumn: weekIndex + 1,
                    gridRow: dayOfWeek + 1,
                  }}
                  title={t("journal.heatmap.cell", {
                    date,
                    count: String(wc),
                  })}
                />
              );
            })}
          </div>
        </div>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="contribution-heatmap-tooltip-fixed"
            style={{
              position: "fixed",
              left: tooltip.x,
              top: tooltip.y - 4,
              transform: "translateX(-50%) translateY(-100%)",
              background: "var(--color-bg-default)",
              border: "1px solid var(--color-border-default)",
              padding: "2px 6px",
              borderRadius: 4,
              fontSize: "0.75em",
              whiteSpace: "nowrap",
              zIndex: 9999,
              pointerEvents: "none",
            }}
          >
            {t("journal.heatmap.cell", {
              date: tooltip.date,
              count: String(tooltip.wordCount),
            })}
          </div>
        )}
      </div>

      {/* Legend — outside the scroll area so it stays visible */}
      <div className="contribution-heatmap-legend">
        <span>{t("journal.heatmap.less")}</span>
        <div className="contribution-heatmap-legend-cells">
          {[0, 1, 2, 3, 4].map((lvl) => (
            <span
              className="contribution-heatmap-cell contribution-heatmap-legend-cell"
              data-level={lvl}
              key={lvl}
            />
          ))}
        </div>
        <span>{t("journal.heatmap.more")}</span>
      </div>
    </>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function getHeatmapLevel(wordCount: number): 0 | 1 | 2 | 3 | 4 {
  if (wordCount === 0) return 0;
  if (wordCount < 100) return 1;
  if (wordCount < 300) return 2;
  if (wordCount < 500) return 3;
  return 4;
}

// Returns month label positions: {month (short name), weekIndex of the first day of that month}.
//
// `intl` is required, not defaulted: a default of "en-US" is the silent English fallback this
// function used to hardcode, and it would read as correct in every test written in English.
// eslint-disable-next-line react-refresh/only-export-components
export function getMonthLabels(
  year: number,
  intl: string,
): { month: string; weekIndex: number }[] {
  const shortMonths = monthShortNames(intl);
  const jan1DayOfWeek = new Date(year, 0, 1).getDay();
  const labels: { month: string; weekIndex: number }[] = [];

  for (let m = 0; m < 12; m++) {
    const firstOfMonth = new Date(year, m, 1);
    const dayOfYear = Math.floor(
      (firstOfMonth.getTime() - new Date(year, 0, 1).getTime()) / 86400000,
    );
    const weekIndex = Math.floor((dayOfYear + jan1DayOfWeek) / 7);
    labels.push({ month: shortMonths[m], weekIndex });
  }
  return labels;
}

// Returns an array of {date, dayOfWeek (0=Sun..6=Sat), weekIndex} for each day in the year.
// weekIndex is 0-based, determined by the ISO week column position.
// eslint-disable-next-line react-refresh/only-export-components
export function getWeekColumns(
  year: number,
): { date: string; dayOfWeek: number; weekIndex: number }[] {
  const result: { date: string; dayOfWeek: number; weekIndex: number }[] = [];
  const jan1 = new Date(year, 0, 1);
  // GitHub-style: column 0 starts on Jan 1, each column is a week (Sun-Sat).
  // weekIndex = floor(dayOfYear / 7) based on offset from Jan 1's weekday.
  const jan1DayOfWeek = jan1.getDay(); // 0=Sun
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const totalDays = isLeap ? 366 : 365;

  for (let d = 0; d < totalDays; d++) {
    const date = new Date(year, 0, 1 + d);
    const dayOfWeek = date.getDay();
    const weekIndex = Math.floor((d + jan1DayOfWeek) / 7);
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    result.push({ date: `${year}-${mm}-${dd}`, dayOfWeek, weekIndex });
  }
  return result;
}

function openJournalDate(date: string) {
  // Resolve path: try to find via file-store tabs or open a new tab
  const { tabs } = useEditorStore.getState();
  // Find any tab whose filePath basename matches the date
  const dateBasename = date + ".md";
  const existing = tabs.find((t) => t.filePath?.endsWith(dateBasename));
  if (existing) {
    useEditorStore.getState().setActiveTab(existing.id);
    return;
  }
  // Can't determine path without journalDir — the parent passes onDateClick for that
}

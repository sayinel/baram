// §56g Contribution Heatmap — GitHub-style 12-month grid
import { useState, useMemo } from "react";
import { useEditorStore } from "../../stores/editor-store";

export interface HeatmapEntry {
  date: string;      // YYYY-MM-DD
  wordCount: number;
}

interface ContributionHeatmapProps {
  entries: HeatmapEntry[];
  year: number;
  onDateClick?: (date: string) => void;
}

export function getHeatmapLevel(wordCount: number): 0 | 1 | 2 | 3 | 4 {
  if (wordCount === 0) return 0;
  if (wordCount < 100) return 1;
  if (wordCount < 300) return 2;
  if (wordCount < 500) return 3;
  return 4;
}

// Returns an array of {date, dayOfWeek (0=Sun..6=Sat), weekIndex} for each day in the year.
// weekIndex is 0-based, determined by the ISO week column position.
export function getWeekColumns(year: number): { date: string; dayOfWeek: number; weekIndex: number }[] {
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

// Returns month label positions: {month (short name), weekIndex of the first day of that month}.
export function getMonthLabels(year: number): { month: string; weekIndex: number }[] {
  const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const jan1DayOfWeek = new Date(year, 0, 1).getDay();
  const labels: { month: string; weekIndex: number }[] = [];

  for (let m = 0; m < 12; m++) {
    const firstOfMonth = new Date(year, m, 1);
    const dayOfYear = Math.floor((firstOfMonth.getTime() - new Date(year, 0, 1).getTime()) / 86400000);
    const weekIndex = Math.floor((dayOfYear + jan1DayOfWeek) / 7);
    labels.push({ month: SHORT_MONTHS[m], weekIndex });
  }
  return labels;
}

const DAY_LABEL_MAP: Record<number, string> = { 1: "Mon", 3: "Wed", 5: "Fri" };

export function ContributionHeatmap({ entries, year, onDateClick }: ContributionHeatmapProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tooltip, setTooltip] = useState<{ date: string; wordCount: number; x: number; y: number } | null>(null);

  const wordCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      map.set(e.date, e.wordCount);
    }
    return map;
  }, [entries]);

  const cells = useMemo(() => getWeekColumns(year), [year]);
  const monthLabels = useMemo(() => getMonthLabels(year), [year]);

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
    <div className="contribution-heatmap-wrapper">
      <button
        className="contribution-heatmap-toggle"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span>기여 히트맵</span>
        <span className="contribution-heatmap-toggle-arrow">{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && (
        <div className="contribution-heatmap" onMouseLeave={() => setTooltip(null)}>
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
              {monthLabels.map(({ month, weekIndex }) => (
                <div
                  key={month}
                  style={{
                    gridColumn: weekIndex + 1,
                    gridRow: 1,
                    fontSize: "0.7em",
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {month}
                </div>
              ))}
            </div>
          </div>

          {/* Main grid: day labels + cells */}
          <div style={{ display: "flex", alignItems: "flex-start" }}>
            {/* Day-of-week labels (Mon, Wed, Fri) */}
            <div className="contribution-heatmap-day-labels">
              {[0, 1, 2, 3, 4, 5, 6].map((dow) => (
                <div key={dow} style={{ height: 10, lineHeight: "10px", fontSize: "0.7em", color: "var(--text-secondary)" }}>
                  {DAY_LABEL_MAP[dow] ?? ""}
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
                    key={date}
                    className="contribution-heatmap-cell"
                    data-level={level}
                    style={{
                      gridColumn: weekIndex + 1,
                      gridRow: dayOfWeek + 1,
                    }}
                    title={`${date}: ${wc} words`}
                    onClick={() => handleCellClick(date)}
                    onMouseEnter={(e) => {
                      const rect = (e.target as HTMLElement).getBoundingClientRect();
                      setTooltip({ date, wordCount: wc, x: rect.left + rect.width / 2, y: rect.top });
                    }}
                    onMouseLeave={() => setTooltip(null)}
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
                background: "var(--bg-primary)",
                border: "1px solid var(--border)",
                padding: "2px 6px",
                borderRadius: 4,
                fontSize: "0.75em",
                whiteSpace: "nowrap",
                zIndex: 9999,
                pointerEvents: "none",
              }}
            >
              {tooltip.date} · {tooltip.wordCount} words
            </div>
          )}
        </div>
      )}
    </div>
  );
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

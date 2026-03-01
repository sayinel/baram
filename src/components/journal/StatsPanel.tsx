// §56g Journal Streaks & Stats panel
import { useState, useMemo } from "react";
import { calculateStreak, calculateMonthStats } from "../../utils/journal-stats";
import { getStreakIcon } from "../../utils/journal-themes";
import { useSettingsStore } from "../../stores/settings-store";

interface StatsPanelProps {
  journalDates: Set<string>;
}

export function StatsPanel({ journalDates }: StatsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const journalThemeId = useSettingsStore((s) => s.journalThemeId);

  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const streak = useMemo(
    () => calculateStreak(journalDates, today),
    [journalDates, today],
  );

  const monthStats = useMemo(() => {
    const now = new Date();
    return calculateMonthStats(journalDates, now.getFullYear(), now.getMonth());
  }, [journalDates]);

  return (
    <div className="journal-stats">
      <button
        className="journal-stats-toggle"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Show stats" : "Hide stats"}
        aria-expanded={!collapsed}
      >
        <span className="journal-stats-toggle-label">Stats</span>
        <span className="journal-stats-toggle-arrow">{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && (
        <div className="journal-stats-body">
          <div className="journal-stats-streak">
            {getStreakIcon(journalThemeId)} Current: <strong>{streak.current}</strong>d &nbsp;·&nbsp; Longest:{" "}
            <strong>{streak.longest}</strong>d
          </div>
          <div className="journal-stats-month">
            This month: {monthStats.total}/{monthStats.daysInMonth} days ({monthStats.percentage}%)
          </div>
        </div>
      )}
    </div>
  );
}

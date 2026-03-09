// §56e Year in Pixels — 365-dot grid showing mood per day
import { useState, useEffect, useMemo } from "react";
import {
  parseMoodFromFrontmatter,
  getMoodColors,
  MOOD_VALUES,
} from "../../utils/journal-mood";
import type { MoodValue } from "../../utils/journal-mood";
import { listDir, readFile } from "../../ipc/invoke";
import { useSettingsStore } from "../../stores/settings-store";

const MONTH_LABELS = [
  "J",
  "F",
  "M",
  "A",
  "M",
  "J",
  "J",
  "A",
  "S",
  "O",
  "N",
  "D",
];

interface Props {
  journalDir: string;
  year: number;
  useHierarchy: boolean;
}

export function YearInPixels({ journalDir, year, useHierarchy }: Props) {
  const [moodMap, setMoodMap] = useState<Map<string, MoodValue>>(new Map());
  const [collapsed, setCollapsed] = useState(true);

  // §56e Theme-aware mood colors
  const theme = useSettingsStore((s) => s.theme);
  const effectiveBase = useMemo<"light" | "dark">(() => {
    if (theme === "light" || theme === "dark") return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }, [theme]);
  const MOOD_COLORS = useMemo(
    () => getMoodColors(effectiveBase),
    [effectiveBase],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const baseDir = useHierarchy ? `${journalDir}/daily` : journalDir;
        const entries = await listDir(baseDir, true);
        const files = entries.filter((e) => !e.isDir && e.name.endsWith(".md"));

        const moods = new Map<string, MoodValue>();
        const reads = files.slice(0, 366).map(async (entry) => {
          const match = entry.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
          if (!match || match[1] !== String(year)) return;
          const dateStr = `${match[1]}-${match[2]}-${match[3]}`;
          try {
            const content = await readFile(entry.path);
            const mood = parseMoodFromFrontmatter(content);
            if (mood) moods.set(dateStr, mood);
          } catch {
            /* skip */
          }
        });
        await Promise.all(reads);
        if (!cancelled) setMoodMap(moods);
      } catch {
        if (!cancelled) setMoodMap(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [journalDir, year, useHierarchy]);

  // Build grid: 12 months, each with days
  const grid = useMemo(() => {
    const months: {
      month: number;
      days: { date: string; mood: MoodValue | null }[];
    }[] = [];
    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(year, m + 1, 0).getDate();
      const days: { date: string; mood: MoodValue | null }[] = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        days.push({ date: dateStr, mood: moodMap.get(dateStr) ?? null });
      }
      months.push({ month: m, days });
    }
    return months;
  }, [year, moodMap]);

  const totalEntries = moodMap.size;

  return (
    <div className="year-in-pixels">
      <button
        className="year-in-pixels-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span>Year in Pixels {year}</span>
        <span className="year-in-pixels-count">{totalEntries} days</span>
        <span className="year-in-pixels-arrow">{collapsed ? "▸" : "▾"}</span>
      </button>

      {!collapsed && (
        <div className="year-in-pixels-grid">
          <div className="year-in-pixels-labels">
            {MONTH_LABELS.map((label, i) => (
              <div key={i} className="year-in-pixels-month-label">
                {label}
              </div>
            ))}
          </div>
          <div className="year-in-pixels-dots">
            {grid.map(({ month, days }) => (
              <div key={month} className="year-in-pixels-month">
                {days.map(({ date, mood }) => (
                  <span
                    key={date}
                    className={`year-in-pixels-dot${mood ? " year-in-pixels-dot-filled" : ""}`}
                    style={mood ? { background: MOOD_COLORS[mood] } : undefined}
                    title={`${date}${mood ? ` — ${mood}` : ""}`}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="year-in-pixels-legend">
            {MOOD_VALUES.map((v) => (
              <span key={v} className="year-in-pixels-legend-item">
                <span
                  className="year-in-pixels-legend-dot"
                  style={{ background: MOOD_COLORS[v] }}
                />
                {v}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// §56e 30-day Mood Trend — dot chart showing recent mood pattern
import { useMemo } from "react";

import type { MoodValue } from "../../utils/journal-mood";

import { MOOD_VALUES } from "../../utils/journal-mood";

const MOOD_COLORS: Record<MoodValue, string> = {
  deep: "#64748B",
  calm: "#94A3B8",
  neutral: "#CBD5E1",
  warm: "#F59E0B",
  bright: "#FBBF24",
};

const MOOD_INDEX: Record<MoodValue, number> = {
  deep: 0,
  calm: 1,
  neutral: 2,
  warm: 3,
  bright: 4,
};

interface Props {
  moodMap: Map<string, MoodValue>;
}

export function MoodTrend30({ moodMap }: Props) {
  const data = useMemo(() => {
    const today = new Date();
    const points: { date: string; day: number; mood: MoodValue | null }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      points.push({
        date: dateStr,
        day: 30 - i,
        mood: moodMap.get(dateStr) ?? null,
      });
    }
    return points;
  }, [moodMap]);

  const hasMoods = data.some((p) => p.mood !== null);
  if (!hasMoods) return null;

  // SVG chart: 300×80
  const W = 280;
  const H = 60;
  const padX = 10;
  const padY = 5;
  const colW = (W - padX * 2) / 29;
  const rowH = (H - padY * 2) / 4;

  return (
    <div className="mood-trend-30">
      <div className="mood-trend-30-header">30-Day Mood</div>
      <svg
        className="mood-trend-30-chart"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
      >
        {/* Grid lines */}
        {MOOD_VALUES.map((v, i) => (
          <line
            key={v}
            stroke="var(--color-border)"
            strokeDasharray="2,2"
            strokeWidth={0.5}
            x1={padX}
            x2={W - padX}
            y1={padY + (4 - i) * rowH}
            y2={padY + (4 - i) * rowH}
          />
        ))}

        {/* Mood dots + connecting line */}
        {data.map((p, i) => {
          if (!p.mood) return null;
          const x = padX + i * colW;
          const y = padY + (4 - MOOD_INDEX[p.mood]) * rowH;

          // Find next point with mood for line
          let nextLine = null;
          for (let j = i + 1; j < data.length; j++) {
            if (data[j].mood) {
              const nx = padX + j * colW;
              const ny = padY + (4 - MOOD_INDEX[data[j].mood!]) * rowH;
              nextLine = { x2: nx, y2: ny };
              break;
            }
          }

          return (
            <g key={p.date}>
              {nextLine && (
                <line
                  opacity={0.4}
                  stroke={MOOD_COLORS[p.mood]}
                  strokeWidth={1}
                  x1={x}
                  x2={nextLine.x2}
                  y1={y}
                  y2={nextLine.y2}
                />
              )}
              <circle cx={x} cy={y} fill={MOOD_COLORS[p.mood]} r={3}>
                <title>{`${p.date}: ${p.mood}`}</title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

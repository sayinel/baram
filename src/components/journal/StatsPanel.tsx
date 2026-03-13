// §56g Journal Streaks & Stats panel
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { resolveJournalDir } from "../../utils/journal";
import {
  calculateMonthStats,
  calculateStreak,
} from "../../utils/journal-stats";
import {
  buildFullCache,
  type JournalStatsCache,
  readStatsCache,
  updateCacheEntry,
  writeStatsCache,
} from "../../utils/journal-stats-cache";
import { ContributionHeatmap, type HeatmapEntry } from "./ContributionHeatmap";

/** One day in milliseconds — cache is considered fresh if lastFullScan is within this. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StatsPanelProps {
  journalDates: Set<string>;
  /** Optional: content of the last saved file for cache update */
  lastSavedContent?: string;
  /** Optional: when provided, update cache entry for this date on save */
  lastSavedDate?: string;
}

export function StatsPanel({
  journalDates,
  lastSavedDate,
  lastSavedContent,
}: StatsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [heatmapEntries, setHeatmapEntries] = useState<HeatmapEntry[]>([]);
  const [cache, setCache] = useState<JournalStatsCache | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const journalDirectory = useSettingsStore((s) => s.journalDirectory);
  const journalUseHierarchy = useSettingsStore((s) => s.journalUseHierarchy);

  // Track processed save to avoid duplicate cache updates
  const lastProcessedSave = useRef<string>("");

  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const currentYear = useMemo(() => new Date().getFullYear(), []);

  // Prefer cache-derived streaks when available, else fall back to journalDates
  const streak = useMemo(() => {
    if (cache) {
      return {
        current: cache.stats.currentStreak,
        longest: cache.stats.longestStreak,
      };
    }
    return calculateStreak(journalDates, today);
  }, [cache, journalDates, today]);

  const monthStats = useMemo(() => {
    const now = new Date();
    return calculateMonthStats(journalDates, now.getFullYear(), now.getMonth());
  }, [journalDates]);

  // Extended stats from cache
  const extStats = useMemo(() => {
    if (!cache) return null;
    const entries = cache.entriesByDate;
    const dates = Object.keys(entries);
    const yearStr = String(currentYear);

    // Year entries & words
    let yearEntries = 0;
    let yearWords = 0;
    // Day-of-week frequency (0=Sun..6=Sat)
    const dowCount = new Array(7).fill(0);
    let monthWords = 0;
    const now = new Date();
    const monthPrefix = `${yearStr}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    for (const d of dates) {
      const w = entries[d].words ?? 0;
      if (d.startsWith(yearStr)) {
        yearEntries++;
        yearWords += w;
      }
      if (d.startsWith(monthPrefix)) {
        monthWords += w;
      }
      // Day of week
      const [y, m, day] = d.split("-").map(Number);
      const dow = new Date(y, m - 1, day).getDay();
      dowCount[dow]++;
    }

    // Most active day of week
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let maxDow = 0;
    for (let i = 1; i < 7; i++) {
      if (dowCount[i] > dowCount[maxDow]) maxDow = i;
    }
    const mostActiveDay = dowCount[maxDow] > 0 ? dayNames[maxDow] : null;

    // Average writing hour
    const hoursWithData = dates
      .map((d) => entries[d].modifiedHour)
      .filter((h): h is number => h !== undefined);
    let avgWritingTime: null | string = null;
    if (hoursWithData.length > 0) {
      // Average using circular mean to handle midnight wraparound correctly
      const TWO_PI = 2 * Math.PI;
      let sinSum = 0;
      let cosSum = 0;
      for (const h of hoursWithData) {
        const angle = (h / 24) * TWO_PI;
        sinSum += Math.sin(angle);
        cosSum += Math.cos(angle);
      }
      const avgAngle = Math.atan2(
        sinSum / hoursWithData.length,
        cosSum / hoursWithData.length,
      );
      const avgHour = ((avgAngle / TWO_PI) * 24 + 24) % 24;
      const h = Math.floor(avgHour);
      const m = Math.round((avgHour - h) * 60);
      const period = h < 12 ? "오전" : "오후";
      const displayH = h % 12 === 0 ? 12 : h % 12;
      const displayM = String(m).padStart(2, "0");
      avgWritingTime = `${period} ${displayH}:${displayM}`;
    }

    return {
      yearEntries,
      yearWords,
      totalEntries: cache.stats.totalEntries,
      totalWords: cache.stats.totalWords,
      monthWords,
      mostActiveDay,
      mostActiveDayCount: dowCount[maxDow],
      avgWritingTime,
    };
  }, [cache, currentYear]);

  /** Run a full cache rebuild and persist it. */
  const runFullScan = useCallback(
    async (resolvedDir: string) => {
      setRefreshing(true);
      try {
        const newCache = await buildFullCache(resolvedDir);
        await writeStatsCache(resolvedDir, newCache);
        setCache(newCache);
        // Derive heatmap entries from cache for current year
        const yearStr = String(currentYear);
        const entries: HeatmapEntry[] = Object.entries(newCache.entriesByDate)
          .filter(([date]) => date.startsWith(yearStr))
          .map(([date, meta]) => ({ date, wordCount: meta.words }));
        setHeatmapEntries(entries);
      } catch {
        // Silently degrade — heatmap stays empty / old
      } finally {
        setRefreshing(false);
      }
    },
    [currentYear],
  );

  // On mount: try cache; if fresh use it, otherwise full scan
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const resolvedDir = resolveJournalDir(null, journalDirectory);
      if (!resolvedDir) return;

      try {
        const cached = await readStatsCache(resolvedDir);
        const isRecent =
          cached !== null &&
          Date.now() - new Date(cached.stats.lastFullScan).getTime() <
            CACHE_MAX_AGE_MS;

        if (isRecent && cached) {
          if (cancelled) return;
          setCache(cached);
          const yearStr = String(currentYear);
          const entries: HeatmapEntry[] = Object.entries(cached.entriesByDate)
            .filter(([date]) => date.startsWith(yearStr))
            .map(([date, meta]) => ({ date, wordCount: meta.words }));
          setHeatmapEntries(entries);
          return;
        }
      } catch {
        // Fall through to full scan
      }

      if (!cancelled) {
        await runFullScan(resolvedDir);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [journalDirectory, currentYear, runFullScan]);

  // When a journal file is saved, update its cache entry incrementally
  useEffect(() => {
    if (!lastSavedDate || !lastSavedContent) return;
    const saveKey = `${lastSavedDate}:${lastSavedContent.length}`;
    if (lastProcessedSave.current === saveKey) return;
    lastProcessedSave.current = saveKey;

    const resolvedDir = resolveJournalDir(null, journalDirectory);
    if (!resolvedDir) return;

    (async () => {
      try {
        const base = cache ?? (await readStatsCache(resolvedDir)) ?? undefined;
        if (!base) return;
        const updated = updateCacheEntry(base, lastSavedDate, lastSavedContent);
        await writeStatsCache(resolvedDir, updated);
        setCache(updated);
        // Refresh heatmap entry for this date
        setHeatmapEntries((prev) => {
          const next = prev.filter((e) => e.date !== lastSavedDate);
          const words = updated.entriesByDate[lastSavedDate]?.words ?? 0;
          if (words > 0) next.push({ date: lastSavedDate, wordCount: words });
          return next;
        });
      } catch {
        // Silently degrade
      }
    })();
  }, [lastSavedDate, lastSavedContent, journalDirectory, cache]);

  const handleRefresh = useCallback(() => {
    const resolvedDir = resolveJournalDir(null, journalDirectory);
    if (!resolvedDir || refreshing) return;
    runFullScan(resolvedDir);
  }, [journalDirectory, refreshing, runFullScan]);

  const handleDateClick = (date: string) => {
    // Find a matching open tab or navigate using the journal path
    const { tabs } = useEditorStore.getState();
    const dateBasename = date + ".md";
    const existing = tabs.find((t) => t.filePath?.endsWith(dateBasename));
    if (existing) {
      useEditorStore.getState().setActiveTab(existing.id);
      return;
    }
    // Try to construct the path and open it
    const resolvedDir = resolveJournalDir(null, journalDirectory);
    if (!resolvedDir) return;
    // date is YYYY-MM-DD; hierarchy layout: daily/YYYY/MM/YYYY-MM-DD.md
    const [y, m] = date.split("-");
    const filePath = journalUseHierarchy
      ? `${resolvedDir}/daily/${y}/${m}/${date}.md`
      : `${resolvedDir}/${date}.md`;
    readFile(filePath)
      .then((content) => {
        const fileName = filePath.split("/").pop() ?? dateBasename;
        useFileStore.getState().setFileContent(filePath, content);
        useEditorStore.getState().openTab({
          id: crypto.randomUUID(),
          filePath,
          title: fileName,
          isDirty: false,
          isPinned: false,
        });
      })
      .catch(() => {});
  };

  return (
    <div className="journal-stats">
      <button
        aria-expanded={!collapsed}
        className="journal-stats-toggle"
        onClick={() => setCollapsed((c) => !c)}
        title={collapsed ? "Show stats" : "Hide stats"}
      >
        <span className="journal-stats-toggle-label">Stats</span>
        <span className="journal-stats-toggle-arrow">
          {collapsed ? "▶" : "▼"}
        </span>
      </button>
      {!collapsed && (
        <div className="journal-stats-body">
          <div className="journal-stats-row">
            <svg
              className="journal-stats-icon"
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="14"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span className="journal-stats-label">Streak</span>
            <span className="journal-stats-value">
              <strong>{streak.current}</strong>d
            </span>
            <span className="journal-stats-sep" />
            <span className="journal-stats-label">Best</span>
            <span className="journal-stats-value">
              <strong>{streak.longest}</strong>d
            </span>
          </div>
          <div className="journal-stats-row">
            <svg
              className="journal-stats-icon"
              fill="none"
              height="14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              width="14"
            >
              <rect height="18" rx="2" ry="2" width="18" x="3" y="4" />
              <line x1="16" x2="16" y1="2" y2="6" />
              <line x1="8" x2="8" y1="2" y2="6" />
              <line x1="3" x2="21" y1="10" y2="10" />
            </svg>
            <span className="journal-stats-label">This month</span>
            <span className="journal-stats-value">
              <strong>{monthStats.total}</strong>/{monthStats.daysInMonth}
            </span>
            <span className="journal-stats-pct">{monthStats.percentage}%</span>
          </div>
          {extStats && (
            <>
              <div className="journal-stats-row">
                <svg
                  className="journal-stats-icon"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M12 20V10" />
                  <path d="M18 20V4" />
                  <path d="M6 20v-4" />
                </svg>
                <span className="journal-stats-label">Year</span>
                <span className="journal-stats-value">
                  <strong>{extStats.yearEntries}</strong>d
                </span>
                <span className="journal-stats-sep" />
                <span className="journal-stats-label">All</span>
                <span className="journal-stats-value">
                  <strong>{extStats.totalEntries}</strong>d
                </span>
              </div>
              <div className="journal-stats-row">
                <svg
                  className="journal-stats-icon"
                  fill="none"
                  height="14"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="14"
                >
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                </svg>
                <span className="journal-stats-label">Words</span>
                <span className="journal-stats-value">
                  <strong>{extStats.monthWords.toLocaleString()}</strong>
                </span>
                <span className="journal-stats-sep" />
                <span className="journal-stats-value">
                  <strong>{extStats.yearWords.toLocaleString()}</strong>
                </span>
                <span className="journal-stats-sep" />
                <span className="journal-stats-value journal-stats-dim">
                  {extStats.totalWords.toLocaleString()}
                </span>
              </div>
              {extStats.mostActiveDay && (
                <div className="journal-stats-row">
                  <svg
                    className="journal-stats-icon"
                    fill="none"
                    height="14"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="14"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className="journal-stats-label">Most active</span>
                  <span className="journal-stats-value">
                    <strong>{extStats.mostActiveDay}</strong>
                  </span>
                  <span className="journal-stats-pct">
                    {extStats.mostActiveDayCount} entries
                  </span>
                </div>
              )}
              {extStats.avgWritingTime && (
                <div className="journal-stats-row">
                  <svg
                    className="journal-stats-icon"
                    fill="none"
                    height="14"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    width="14"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className="journal-stats-label">평균 작성 시간</span>
                  <span className="journal-stats-value">
                    <strong>{extStats.avgWritingTime}</strong>
                  </span>
                </div>
              )}
            </>
          )}
          <button
            aria-label="Refresh journal stats"
            className="journal-stats-refresh"
            disabled={refreshing}
            onClick={handleRefresh}
            title="Refresh stats"
          >
            <svg
              fill="none"
              height="12"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.5"
              viewBox="0 0 24 24"
              width="12"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      )}
      <ContributionHeatmap
        entries={heatmapEntries}
        onDateClick={handleDateClick}
        year={currentYear}
      />
    </div>
  );
}

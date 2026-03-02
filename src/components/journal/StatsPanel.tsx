// §56g Journal Streaks & Stats panel
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { calculateStreak, calculateMonthStats } from "../../utils/journal-stats";
import {
  readStatsCache,
  writeStatsCache,
  buildFullCache,
  updateCacheEntry,
  type JournalStatsCache,
} from "../../utils/journal-stats-cache";
import { getStreakIcon } from "../../utils/journal-themes";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { readFile } from "../../ipc/invoke";
import { resolveJournalDir } from "../../utils/journal";
import { ContributionHeatmap, type HeatmapEntry } from "./ContributionHeatmap";

/** One day in milliseconds — cache is considered fresh if lastFullScan is within this. */
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface StatsPanelProps {
  journalDates: Set<string>;
  /** Optional: when provided, update cache entry for this date on save */
  lastSavedDate?: string;
  /** Optional: content of the last saved file for cache update */
  lastSavedContent?: string;
}

export function StatsPanel({ journalDates, lastSavedDate, lastSavedContent }: StatsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [heatmapEntries, setHeatmapEntries] = useState<HeatmapEntry[]>([]);
  const [cache, setCache] = useState<JournalStatsCache | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const journalThemeId = useSettingsStore((s) => s.journalThemeId);
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
      return { current: cache.stats.currentStreak, longest: cache.stats.longestStreak };
    }
    return calculateStreak(journalDates, today);
  }, [cache, journalDates, today]);

  const monthStats = useMemo(() => {
    const now = new Date();
    return calculateMonthStats(journalDates, now.getFullYear(), now.getMonth());
  }, [journalDates]);

  /** Run a full cache rebuild and persist it. */
  const runFullScan = useCallback(async (resolvedDir: string) => {
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
  }, [currentYear]);

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
          Date.now() - new Date(cached.stats.lastFullScan).getTime() < CACHE_MAX_AGE_MS;

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
    return () => { cancelled = true; };
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
          <button
            className="journal-stats-refresh"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh stats"
            aria-label="Refresh journal stats"
          >
            {refreshing ? "..." : "↻"}
          </button>
        </div>
      )}
      <ContributionHeatmap
        entries={heatmapEntries}
        year={currentYear}
        onDateClick={handleDateClick}
      />
    </div>
  );
}

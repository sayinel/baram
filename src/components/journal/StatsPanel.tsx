// §56g Journal Streaks & Stats panel
import { useState, useEffect, useMemo } from "react";
import { calculateStreak, calculateMonthStats } from "../../utils/journal-stats";
import { getStreakIcon } from "../../utils/journal-themes";
import { useSettingsStore } from "../../stores/settings-store";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { listDir, readFile } from "../../ipc/invoke";
import { resolveJournalDir } from "../../utils/journal";
import { ContributionHeatmap, type HeatmapEntry } from "./ContributionHeatmap";

interface StatsPanelProps {
  journalDates: Set<string>;
}

export function StatsPanel({ journalDates }: StatsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [heatmapEntries, setHeatmapEntries] = useState<HeatmapEntry[]>([]);

  const journalThemeId = useSettingsStore((s) => s.journalThemeId);
  const journalDirectory = useSettingsStore((s) => s.journalDirectory);
  const journalUseHierarchy = useSettingsStore((s) => s.journalUseHierarchy);

  const today = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);

  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const streak = useMemo(
    () => calculateStreak(journalDates, today),
    [journalDates, today],
  );

  const monthStats = useMemo(() => {
    const now = new Date();
    return calculateMonthStats(journalDates, now.getFullYear(), now.getMonth());
  }, [journalDates]);

  // Load word counts for heatmap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resolvedDir = resolveJournalDir(null, journalDirectory);
        if (!resolvedDir) return;
        const baseDir = journalUseHierarchy ? `${resolvedDir}/daily` : resolvedDir;
        const entries = await listDir(baseDir, true);
        const files = entries.filter(
          (e) => !e.isDir && e.name.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(e.name),
        );
        const yearStr = String(currentYear);
        const yearFiles = files.filter((e) => e.name.startsWith(yearStr));

        const reads = yearFiles.map(async (entry) => {
          const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
          if (!match) return null;
          try {
            const content = await readFile(entry.path);
            const wordCount = content.split(/\s+/).filter(Boolean).length;
            return { date: match[1], wordCount } satisfies HeatmapEntry;
          } catch {
            return null;
          }
        });

        const results = (await Promise.all(reads)).filter((r): r is HeatmapEntry => r !== null);
        if (!cancelled) setHeatmapEntries(results);
      } catch {
        if (!cancelled) setHeatmapEntries([]);
      }
    })();
    return () => { cancelled = true; };
  }, [journalDirectory, journalUseHierarchy, currentYear]);

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

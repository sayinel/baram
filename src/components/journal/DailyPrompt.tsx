// §56i Daily Writing Prompt — compact display with refresh + history tracking (§10.5)
import { useState, useEffect } from "react";
import {
  DAILY_PROMPTS,
  getPromptAvoidingHistory,
} from "../../utils/journal-prompts";
import {
  readPromptHistory,
  addPromptToHistory,
} from "../../utils/journal-stats-cache";
import { useSettingsStore } from "../../stores/settings-store";
import { resolveJournalDir } from "../../utils/journal";

interface Props {
  date?: Date;
}

export function DailyPrompt({ date }: Props) {
  const effectiveDate = date ?? new Date();
  const journalDirectory = useSettingsStore((s) => s.journalDirectory);
  const journalDir = resolveJournalDir(null, journalDirectory);

  // null = loading, string = ready
  const [prompt, setPrompt] = useState<string | null>(null);
  // Local mirror of used IDs so refresh can exclude already-shown prompts
  const [usedIds, setUsedIds] = useState<string[]>([]);

  // On mount (or when journalDir/date changes): load history, pick first prompt
  useEffect(() => {
    let cancelled = false;

    const pick = (ids: string[]) => {
      const p = getPromptAvoidingHistory(effectiveDate, ids);
      if (cancelled) return;
      setPrompt(p.text);
      const next = [...ids, p.id].slice(-50);
      setUsedIds(next);
      if (journalDir) {
        addPromptToHistory(journalDir, p.id).catch(() => {});
      }
    };

    if (!journalDir) {
      pick([]);
      return;
    }

    readPromptHistory(journalDir)
      .then((ids) => {
        if (!cancelled) pick(ids);
      })
      .catch(() => {
        if (!cancelled) pick([]);
      });

    return () => {
      cancelled = true;
    };
    // effectiveDate.toDateString() gives a stable string dep for date changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journalDir, effectiveDate.toDateString()]);

  const handleRefresh = () => {
    // Exclude current prompt's ID too so refresh always shows something new
    const currentId = prompt
      ? (DAILY_PROMPTS.find((p) => p.text === prompt)?.id ?? null)
      : null;
    const excludeIds = currentId ? [...usedIds, currentId] : usedIds;

    const p = getPromptAvoidingHistory(effectiveDate, excludeIds);
    setPrompt(p.text);
    const next = [...usedIds, p.id].slice(-50);
    setUsedIds(next);
    if (journalDir) {
      addPromptToHistory(journalDir, p.id).catch(() => {});
    }
  };

  // Don't render until the first prompt is ready
  if (prompt === null) return null;

  return (
    <div className="daily-prompt">
      <span className="daily-prompt-icon">💡</span>
      <span className="daily-prompt-text">{prompt}</span>
      <button
        className="daily-prompt-refresh"
        onClick={handleRefresh}
        title="다른 글감 보기"
        type="button"
      >
        🔄
      </button>
    </div>
  );
}

// §56j Periodic Insight Banner — auto AI analysis for weekly/monthly notes
import { useCallback, useEffect, useRef, useState } from "react";

import { useLLMStream } from "../../hooks/use-llm-stream";
import { listDir, readFile } from "../../ipc/invoke";
import { useAIStore } from "../../stores/ai/ai";
import { useSettingsStore } from "../../stores/settings/store";
import { resolveJournalDir } from "../../utils/journal/journal";
import { renderSimpleMarkdown } from "../../utils/journal/journal-memories";
import {
  buildMonthlySummaryPrompt,
  buildWeeklyPatternPrompt,
} from "../../utils/journal/journal-reflection";
import { logger } from "../../utils/logger";

type InsightType = "monthly" | "weekly";

interface Props {
  filePath: string;
  type: InsightType;
}

/**
 * Detect if a file path is a weekly or monthly periodic note.
 * Returns null if it's neither.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function detectPeriodicType(filePath: string): InsightType | null {
  if (/\/weekly\//.test(filePath)) return "weekly";
  if (/\/monthly\//.test(filePath)) return "monthly";
  return null;
}

export function PeriodicInsightBanner({ filePath, type }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const dismissedPaths = useRef(new Set<string>());

  const { send, cancel, isStreaming, text } = useLLMStream();
  const { provider, apiKey, privacyMode } = useAIStore();
  const { journalDirectory, journalUseHierarchy, journalAIReflectionEnabled } =
    useSettingsStore();

  const resolvedDir = resolveJournalDir(null, journalDirectory);

  // Check if LLM is available
  const isLLMAvailable =
    journalAIReflectionEnabled &&
    (provider === "ollama" || (apiKey && apiKey.length > 0)) &&
    (!privacyMode || provider === "ollama");

  // Reset when filePath changes
  useEffect(() => {
    if (dismissedPaths.current.has(filePath)) {
      setDismissed(true);
    } else {
      setDismissed(false);
      setGenerating(false);
    }
  }, [filePath]);

  const handleGenerate = useCallback(async () => {
    if (!resolvedDir) return;
    setGenerating(true);

    try {
      // Determine date range from filename
      const now = new Date();
      let startDate: Date;
      let endDate: Date;

      if (type === "weekly") {
        // Extract week info from filename like 2026-W09.md
        const weekMatch = filePath.match(/(\d{4})-W(\d{2})/);
        if (weekMatch) {
          const year = parseInt(weekMatch[1]);
          const week = parseInt(weekMatch[2]);
          // Approximate: week 1 starts on Jan 1
          startDate = new Date(year, 0, 1 + (week - 1) * 7);
          endDate = new Date(startDate);
          endDate.setDate(startDate.getDate() + 6);
        } else {
          endDate = now;
          startDate = new Date(now);
          startDate.setDate(now.getDate() - 6);
        }
      } else {
        // Monthly: extract from filename like 2026-02.md
        const monthMatch = filePath.match(/(\d{4})-(\d{2})\.md/);
        if (monthMatch) {
          const year = parseInt(monthMatch[1]);
          const month = parseInt(monthMatch[2]) - 1;
          startDate = new Date(year, month, 1);
          endDate = new Date(year, month + 1, 0);
        } else {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }
      }

      // Collect daily entries in range
      let fileEntries: { name: string; path: string }[] = [];
      try {
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
      } catch {
        // directory may not exist
      }

      const journalEntries: { content: string; date: string }[] = [];
      for (const entry of fileEntries) {
        const match = entry.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
        if (!match) continue;
        const fileDate = new Date(
          parseInt(match[1]),
          parseInt(match[2]) - 1,
          parseInt(match[3]),
        );
        if (fileDate >= startDate && fileDate <= endDate) {
          try {
            const content = await readFile(entry.path);
            journalEntries.push({
              date: `${match[1]}-${match[2]}-${match[3]}`,
              content,
            });
          } catch {
            // skip
          }
        }
      }

      journalEntries.sort((a, b) => a.date.localeCompare(b.date));

      const { systemPrompt, userPrompt } =
        type === "weekly"
          ? buildWeeklyPatternPrompt(journalEntries)
          : buildMonthlySummaryPrompt(journalEntries);

      send(userPrompt, systemPrompt);
    } catch (e) {
      logger.error("[PeriodicInsightBanner] Error:", e);
      setGenerating(false);
    }
  }, [resolvedDir, type, filePath, journalUseHierarchy, send]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    dismissedPaths.current.add(filePath);
    if (isStreaming) cancel();
  }, [filePath, isStreaming, cancel]);

  if (!isLLMAvailable || dismissed) return null;

  const label =
    type === "weekly" ? "이번 주 패턴을 분석할까요?" : "이번 달을 요약할까요?";

  return (
    <div className="periodic-insight-banner">
      {!generating && !text && (
        <>
          <span className="periodic-insight-label">&#x2728; {label}</span>
          <button className="periodic-insight-btn" onClick={handleGenerate}>
            분석하기
          </button>
          <button
            className="periodic-insight-dismiss"
            onClick={handleDismiss}
            title="닫기"
          >
            &times;
          </button>
        </>
      )}
      {(generating || text) && (
        <div className="periodic-insight-result">
          {text ? (
            <div
              className="periodic-insight-md reflection-md-render"
              dangerouslySetInnerHTML={{
                __html: renderSimpleMarkdown(text),
              }}
            />
          ) : (
            <span className="periodic-insight-loading">분석 중...</span>
          )}
          {isStreaming && <span className="reflection-cursor">&#x258b;</span>}
          {!isStreaming && text && (
            <button
              className="periodic-insight-dismiss"
              onClick={handleDismiss}
              title="닫기"
            >
              &times;
            </button>
          )}
        </div>
      )}
    </div>
  );
}

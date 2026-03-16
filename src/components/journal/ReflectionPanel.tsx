// §56j AI Reflection Panel — generates AI-powered journal insights
import { useCallback, useEffect, useState } from "react";

import { Sparkles } from "lucide-react";

import { useLLMStream } from "../../hooks/use-llm-stream";
import { createDir, listDir, readFile, writeFile } from "../../ipc/invoke";
import { useAIStore } from "../../stores/ai/ai";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { formatAIError } from "../../utils/format-error";
import { resolveJournalDir } from "../../utils/journal/journal";
import { renderSimpleMarkdown } from "../../utils/journal/journal-memories";
import {
  buildReflectionPrompt,
  extractReflectionEntries,
  formatReflectionMarkdown,
} from "../../utils/journal/journal-reflection";
import { logger } from "../../utils/logger";

type Period = "month" | "week";

interface Props {
  onClose?: () => void;
}

export function ReflectionPanel({ onClose }: Props) {
  const [period, setPeriod] = useState<Period>("week");
  const [savedPath, setSavedPath] = useState<null | string>(null);
  const [saving, setSaving] = useState(false);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const { send, cancel, isStreaming, text, error } = useLLMStream();

  const { provider, apiKey, privacyMode } = useAIStore();
  const { journalEnabled, journalDirectory, journalUseHierarchy } =
    useSettingsStore();

  const resolvedDir = resolveJournalDir(null, journalDirectory);

  // Check if LLM is configured
  const isLLMConfigured =
    provider === "ollama" || (apiKey && apiKey.length > 0);

  const handleGenerate = useCallback(async () => {
    if (!resolvedDir) return;
    setSavedPath(null);
    setLoadingEntries(true);

    try {
      const now = new Date();
      const { startDate, endDate } = extractReflectionEntries(
        resolvedDir,
        period,
        now,
      );

      // Collect files from journal directory
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
        // directory may not exist yet — proceed with empty entries
      }

      // Filter files by date range
      const journalEntries: { content: string; date: string }[] = [];

      for (const entry of fileEntries) {
        const match =
          entry.name.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/) ||
          entry.name.match(/^(\d{4})(\d{2})(\d{2})\.md$/);
        if (!match) continue;

        const fileDate = new Date(
          parseInt(match[1]),
          parseInt(match[2]) - 1,
          parseInt(match[3]),
        );

        if (fileDate >= startDate && fileDate <= endDate) {
          try {
            const content = await readFile(entry.path);
            const dateStr = `${match[1]}-${match[2]}-${match[3]}`;
            journalEntries.push({ date: dateStr, content });
          } catch {
            // skip unreadable files
          }
        }
      }

      // Sort by date ascending
      journalEntries.sort((a, b) => a.date.localeCompare(b.date));

      setLoadingEntries(false);

      const { systemPrompt, userPrompt } = buildReflectionPrompt(
        journalEntries,
        period,
      );
      send(userPrompt, systemPrompt);
    } catch (e) {
      logger.error("[ReflectionPanel] Error collecting entries:", e);
      setLoadingEntries(false);
    }
  }, [resolvedDir, period, journalUseHierarchy, send]);

  const handleSave = useCallback(async () => {
    if (!text || !resolvedDir) return;
    setSaving(true);

    try {
      const now = new Date();
      const { startDate, endDate } = extractReflectionEntries(
        resolvedDir,
        period,
        now,
      );
      const markdown = formatReflectionMarkdown(
        text,
        period,
        startDate,
        endDate,
      );

      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const notesDir = `${resolvedDir}/notes`;

      await createDir(notesDir).catch(() => {});

      const filePath = `${notesDir}/reflection-${yyyy}-${mm}-${dd}.md`;
      await writeFile(filePath, markdown);

      setSavedPath(filePath);

      // Open the saved note in editor
      const fileName = filePath.split("/").pop() ?? "reflection.md";
      const { tabs } = useEditorStore.getState();
      const existing = tabs.find((t) => t.filePath === filePath);
      if (existing) {
        useEditorStore.getState().setActiveTab(existing.id);
      } else {
        useFileStore.getState().setFileContent(filePath, markdown);
        useEditorStore.getState().openTab({
          id: crypto.randomUUID(),
          filePath,
          title: fileName,
          isDirty: false,
          isPinned: false,
        });
      }

      onClose?.();
    } catch (e) {
      logger.error("[ReflectionPanel] Failed to save reflection:", e);
    } finally {
      setSaving(false);
    }
  }, [text, resolvedDir, period, onClose]);

  // Reset saved state when period changes
  useEffect(() => {
    setSavedPath(null);
  }, [period]);

  if (!journalEnabled) {
    return (
      <div className="reflection-panel">
        <div className="reflection-empty">
          Journal이 비활성화되어 있습니다. 설정에서 Journal을 활성화하세요.
        </div>
      </div>
    );
  }

  if (!isLLMConfigured && !privacyMode) {
    return (
      <div className="reflection-panel">
        {onClose && (
          <div className="reflection-header flex-header">
            <span className="reflection-title">AI Reflection</span>
            <button
              className="reflection-close-btn btn-unstyled"
              onClick={onClose}
              title="닫기"
            >
              ×
            </button>
          </div>
        )}
        <div className="reflection-empty">
          AI 설정에서 LLM 프로바이더를 먼저 설정하세요.
        </div>
      </div>
    );
  }

  if (privacyMode && provider !== "ollama") {
    return (
      <div className="reflection-panel">
        {onClose && (
          <div className="reflection-header flex-header">
            <span className="reflection-title">AI Reflection</span>
            <button
              className="reflection-close-btn btn-unstyled"
              onClick={onClose}
              title="닫기"
            >
              ×
            </button>
          </div>
        )}
        <div className="reflection-empty">
          프라이버시 모드에서는 Ollama(로컬 모델)만 사용할 수 있습니다.
        </div>
      </div>
    );
  }

  const formattedError = error ? formatAIError(error) : null;

  return (
    <div className="reflection-panel">
      <div className="reflection-header flex-header">
        <span className="reflection-title">
          <Sparkles size={14} /> AI Reflection
        </span>
        {onClose && (
          <button
            className="reflection-close-btn btn-unstyled"
            onClick={onClose}
            title="닫기"
          >
            ×
          </button>
        )}
      </div>

      <div className="reflection-period-btns">
        <button
          className={`reflection-period-btn${period === "week" ? "reflection-period-btn-active" : ""}`}
          disabled={isStreaming || loadingEntries}
          onClick={() => setPeriod("week")}
        >
          This Week
        </button>
        <button
          className={`reflection-period-btn${period === "month" ? "reflection-period-btn-active" : ""}`}
          disabled={isStreaming || loadingEntries}
          onClick={() => setPeriod("month")}
        >
          This Month
        </button>
      </div>

      {formattedError && (
        <div className="reflection-error">
          <strong>{formattedError.title}</strong>
          <span>{formattedError.detail}</span>
        </div>
      )}

      {text && (
        <div className="reflection-output reflection-md-render">
          <div
            dangerouslySetInnerHTML={{ __html: renderSimpleMarkdown(text) }}
          />
          {isStreaming && <span className="reflection-cursor">▋</span>}
        </div>
      )}

      {!text && !isStreaming && !loadingEntries && (
        <div className="reflection-placeholder">
          {period === "week"
            ? "이번 주 일기를 분석하여 인사이트를 생성합니다."
            : "이번 달 일기를 분석하여 인사이트를 생성합니다."}
        </div>
      )}

      {loadingEntries && (
        <div className="reflection-placeholder">일기 파일을 불러오는 중...</div>
      )}

      <div className="reflection-actions">
        {isStreaming ? (
          <button
            className="reflection-btn reflection-btn-stop"
            onClick={cancel}
          >
            중지
          </button>
        ) : (
          <button
            className="reflection-btn reflection-btn-generate"
            disabled={loadingEntries}
            onClick={handleGenerate}
          >
            {loadingEntries ? "로딩 중..." : "Generate Reflection"}
          </button>
        )}
        {text && !isStreaming && (
          <button
            className="reflection-btn reflection-btn-save"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "저장 중..." : savedPath ? "저장됨 ✓" : "Save as Note"}
          </button>
        )}
      </div>
    </div>
  );
}

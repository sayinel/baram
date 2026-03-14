// §72c Skill Optimize Section — LLM-powered prompt optimization suggestions
import { useCallback, useState } from "react";

import { useLLMStream } from "../../hooks/use-llm-stream";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSkillStore } from "../../stores/skill-store";
import {
  buildOptimizePrompt,
  type OptimizeSuggestion,
  parseOptimizeResponse,
} from "../../utils/skill/skill-optimize-prompt";
import { registerSkillSection } from "./skill-panel-registry";

// ─── Category icons ──────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<string, string> = {
  clarity: "\u{1F50D}", // magnifying glass
  efficiency: "\u26A1", // lightning
  missing: "\u2795", // plus
  variables: "\u{1F4DD}", // memo
};

// ─── SuggestionCard ──────────────────────────────────────────────────────────

export function SkillOptimizeSection() {
  const isSkill = useSkillStore((s) => s.isSkill);
  const { send, cancel, isStreaming, text, error } = useLLMStream();

  const [suggestions, setSuggestions] = useState<OptimizeSuggestion[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const handleOptimize = useCallback(() => {
    const { activeTabId, tabs } = useEditorStore.getState();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab?.filePath) return;
    const content = useFileStore.getState().openFiles.get(activeTab.filePath);
    if (!content) return;

    setSuggestions([]);
    setHasRun(true);
    setExpanded(true);
    const prompt = buildOptimizePrompt(content);
    send(prompt, undefined, { task: "chat" });
  }, [send]);

  // When streaming finishes (text is complete & not streaming), try to parse
  // We track this via a ref-like approach: parse on each render when not streaming
  const parsedSuggestions =
    !isStreaming && hasRun && text ? parseOptimizeResponse(text) : suggestions;

  // Update suggestions state when streaming completes
  if (!isStreaming && hasRun && text && parsedSuggestions !== suggestions) {
    // Side-effect in render — only when streaming just finished
    if (parsedSuggestions.length > 0 || text.length > 0) {
      // Use setTimeout to avoid setState during render
      setTimeout(() => setSuggestions(parsedSuggestions), 0);
    }
  }

  const displaySuggestions = isStreaming ? suggestions : parsedSuggestions;

  // Early return after all hooks
  if (!isSkill) return null;

  return (
    <div className="skill-optimize">
      <button
        className="skill-optimize-header-btn"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="skill-section-arrow">
          {expanded ? "\u25BE" : "\u25B8"}
        </span>
        <span>Optimize</span>
        {displaySuggestions.length > 0 && (
          <span className="skill-optimize-badge">
            {displaySuggestions.length}
          </span>
        )}
      </button>

      {expanded && (
        <div className="skill-optimize-body">
          <div className="skill-optimize-actions">
            {!isStreaming ? (
              <button
                className="skill-optimize-btn"
                disabled={isStreaming}
                onClick={handleOptimize}
              >
                {hasRun ? "Re-analyze" : "Analyze Prompt"}
              </button>
            ) : (
              <button className="skill-optimize-btn" onClick={cancel}>
                Cancel
              </button>
            )}
          </div>

          {isStreaming && (
            <div className="skill-optimize-loading">
              <span className="skill-optimize-spinner" />
              Analyzing...
            </div>
          )}

          {error && <div className="skill-optimize-error">{error}</div>}

          {displaySuggestions.length > 0 && (
            <div className="skill-optimize-cards">
              {displaySuggestions.map((s, i) => (
                <SuggestionCard key={i} suggestion={s} />
              ))}
            </div>
          )}

          {!isStreaming &&
            hasRun &&
            displaySuggestions.length === 0 &&
            !error && (
              <div className="skill-optimize-empty">
                No suggestions found. The prompt looks good!
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// ─── SkillOptimizeSection ────────────────────────────────────────────────────

function SuggestionCard({ suggestion }: { suggestion: OptimizeSuggestion }) {
  const handleApply = useCallback(() => {
    if (!suggestion.before || !suggestion.after) return;
    const { activeTabId, tabs, markDirty, requestContentRefresh } =
      useEditorStore.getState();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab?.filePath) return;
    const content = useFileStore.getState().openFiles.get(activeTab.filePath);
    if (!content) return;
    const newContent = content.replace(suggestion.before, suggestion.after);
    if (newContent === content) return; // not found
    useFileStore.getState().setFileContent(activeTab.filePath, newContent);
    if (activeTabId) markDirty(activeTabId, true);
    requestContentRefresh();
  }, [suggestion]);

  return (
    <div className="skill-optimize-card">
      <div className="skill-optimize-card-header">
        <span className="skill-optimize-category">
          {CATEGORY_ICONS[suggestion.category] ?? ""} {suggestion.category}
        </span>
        <span className="skill-optimize-title">{suggestion.title}</span>
      </div>
      <div className="skill-optimize-desc">{suggestion.description}</div>
      {(suggestion.before || suggestion.after) && (
        <div className="skill-optimize-diff">
          {suggestion.before && (
            <div className="skill-optimize-before">- {suggestion.before}</div>
          )}
          {suggestion.after && (
            <div className="skill-optimize-after">+ {suggestion.after}</div>
          )}
        </div>
      )}
      {suggestion.before && suggestion.after && (
        <button className="skill-optimize-apply" onClick={handleApply}>
          Apply
        </button>
      )}
    </div>
  );
}

// §72c Self-register into skill panel registry
registerSkillSection({
  id: "optimize",
  title: "Optimize",
  order: 40,
  component: SkillOptimizeSection,
});

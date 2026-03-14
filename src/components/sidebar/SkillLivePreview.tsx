// §72c Skill Live Preview — auto-updating LLM prompt preview in PropertiesPanel
import { useEffect, useMemo, useState } from "react";

import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSkillStore } from "../../stores/skill-store";
import { extractSkillPrompt } from "../../utils/skill/skill-test-runner";
import {
  estimateTokenCount,
  formatTokenCount,
} from "../../utils/token-counter";
import { registerSkillSection } from "./skill-panel-registry";

// ─── Variable highlighting ──────────────────────────────────────────────────

export function SkillLivePreview() {
  const { activeTabId, tabs } = useEditorStore();
  const openFiles = useFileStore((s) => s.openFiles);
  const contentRefreshKey = useEditorStore((s) => s.contentRefreshKey);
  const isSkill = useSkillStore((s) => s.isSkill);

  const [expanded, setExpanded] = useState(false);
  const [debouncedContent, setDebouncedContent] = useState("");

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;
  const content = filePath ? (openFiles.get(filePath) ?? "") : "";

  // Debounce content updates (500ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedContent(content), 500);
    return () => clearTimeout(timer);
  }, [content, contentRefreshKey]);

  const preview = useMemo(() => {
    if (!debouncedContent) return null;
    const { system, user } = extractSkillPrompt(debouncedContent);
    if (!system && !user) return null;

    const parts: string[] = [];
    if (system) parts.push(system);
    if (user) parts.push(user);
    const fullText = parts.join("\n\n");
    const tokenCount = estimateTokenCount(fullText);

    return { system, user, tokenCount };
  }, [debouncedContent]);

  // Early return after all hooks (Rules of Hooks)
  if (!isSkill || !filePath) return null;

  return (
    <div className="skill-live-preview">
      <button className="slp-header" onClick={() => setExpanded((v) => !v)}>
        <span className="skill-section-arrow">
          {expanded ? "\u25be" : "\u25b8"}
        </span>
        <span>Preview</span>
        {preview && (
          <span className="slp-token-badge">
            ~{formatTokenCount(preview.tokenCount)}
          </span>
        )}
      </button>

      {expanded && preview && (
        <div className="slp-content">
          {preview.system && (
            <div className="slp-block">
              <div className="slp-label">System</div>
              <div className="slp-text">
                {highlightVariables(preview.system)}
              </div>
            </div>
          )}
          {preview.user && (
            <div className="slp-block">
              <div className="slp-label">User</div>
              <div className="slp-text">{highlightVariables(preview.user)}</div>
            </div>
          )}
        </div>
      )}

      {expanded && !preview && (
        <div className="slp-content">
          <div className="slp-text" style={{ color: "var(--text-secondary)" }}>
            No &lt;system&gt; or &lt;user&gt; blocks found.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SkillLivePreview ───────────────────────────────────────────────────────

function highlightVariables(text: string): React.ReactNode[] {
  const parts = text.split(/(\{\{[^}]+\}\})/g);
  return parts.map((part, i) =>
    part.startsWith("{{") ? (
      <span className="slp-var" key={i}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

// §72c Self-register into skill panel registry
registerSkillSection({
  id: "live-preview",
  title: "Preview",
  order: 30,
  component: SkillLivePreview,
});

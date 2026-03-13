// §72 LLM 관점 미리보기 — 스킬 파일을 LLM이 받는 형태로 프리뷰
import { useMemo } from "react";

import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { extractSkillPrompt } from "../../utils/skill-test-runner";
import {
  estimateTokenCount,
  formatTokenCount,
} from "../../utils/token-counter";

interface SkillPreviewPanelProps {
  onClose: () => void;
  visible: boolean;
}

export function SkillPreviewPanel({
  visible,
  onClose,
}: SkillPreviewPanelProps) {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const openFiles = useFileStore((s) => s.openFiles);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? null;
  const content = filePath ? (openFiles.get(filePath) ?? "") : "";

  const preview = useMemo(() => {
    if (!content) return null;
    const { system, user, variables } = extractSkillPrompt(content);

    const parts: string[] = [];
    if (system) parts.push(`[SYSTEM]\n${system}`);
    if (user) parts.push(`[USER]\n${user}`);

    const fullText = parts.join("\n\n---\n\n");
    const tokenCount = estimateTokenCount(fullText);

    return { system, user, variables, fullText, tokenCount };
  }, [content]);

  if (!visible || !preview) return null;

  return (
    <div className="skill-preview-panel">
      <div className="skill-preview-header">
        <span>LLM Preview</span>
        <span className="skill-preview-tokens">
          ~{formatTokenCount(preview.tokenCount)} tokens
        </span>
        <button className="skill-preview-close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="skill-preview-body">
        {preview.variables.length > 0 && (
          <div className="skill-preview-variables">
            Variables:{" "}
            {preview.variables.map((v) => (
              <span className="skill-preview-var" key={v}>{`{{${v}}}`}</span>
            ))}
          </div>
        )}
        <pre className="skill-preview-content">{preview.fullText}</pre>
      </div>
    </div>
  );
}

// §47 Skill Inline Test — run a Skill file against sample input
import { useCallback, useEffect, useState } from "react";

import { useLLMStream } from "../../hooks/use-llm-stream";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { formatAIError } from "../../utils/format-error";
import {
  extractSkillPrompt,
  runSkillTest,
} from "../../utils/skill/skill-test-runner";

interface SkillTestDialogProps {
  onClose: () => void;
  open: boolean;
}

export function SkillTestDialog({ open, onClose }: SkillTestDialogProps) {
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [requiredVars, setRequiredVars] = useState<string[]>([]);
  const [skillContent, setSkillContent] = useState("");
  const { send, cancel, isStreaming, text, error, totalTokens } =
    useLLMStream();

  // Load skill content from the current active tab
  useEffect(() => {
    if (!open) return;
    const { activeTabId, tabs } = useEditorStore.getState();
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab?.filePath) return;

    const content = useFileStore.getState().openFiles.get(activeTab.filePath);
    if (!content) return;

    setSkillContent(content);
    const { variables: vars } = extractSkillPrompt(content);
    setRequiredVars(vars);
    // Initialize variable inputs
    const initial: Record<string, string> = {};
    for (const v of vars) {
      initial[v] = "";
    }
    setVariables(initial);
  }, [open]);

  const handleRun = useCallback(() => {
    if (!skillContent) return;
    const { systemPrompt, userPrompt } = runSkillTest(skillContent, variables);
    send(userPrompt, systemPrompt);
  }, [skillContent, variables, send]);

  const handleVarChange = useCallback((key: string, value: string) => {
    setVariables((prev) => ({ ...prev, [key]: value }));
  }, []);

  if (!open) return null;

  return (
    <div className="new-skill-overlay" onClick={onClose}>
      <div className="new-skill-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="new-skill-title">Test Skill</h3>

        {requiredVars.length === 0 ? (
          <div className="new-skill-message">
            No template variables found in this Skill file. Make sure the
            current file contains {"<system>"} and/or {"<user>"} blocks with{" "}
            {`{{variable}}`} placeholders.
          </div>
        ) : (
          <div className="new-skill-field">
            {requiredVars.map((v) => (
              <div className="new-skill-var-row" key={v}>
                <label className="custom-ai-label">{`{{${v}}}`}</label>
                <textarea
                  className="custom-ai-prompt-input"
                  onChange={(e) => handleVarChange(v, e.target.value)}
                  placeholder={`Enter value for {{${v}}}...`}
                  rows={2}
                  value={variables[v] || ""}
                />
              </div>
            ))}
          </div>
        )}

        <div className="new-skill-run-row">
          <button
            className="custom-ai-btn custom-ai-btn-primary"
            disabled={isStreaming || !skillContent}
            onClick={handleRun}
          >
            {isStreaming ? "Running..." : "Run Test"}
          </button>
          {isStreaming && (
            <button className="custom-ai-btn" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>

        {(text || isStreaming) && (
          <div className="new-skill-section">
            <label className="custom-ai-label">Result</label>
            <pre className="skill-gen-preview">
              {text || "Waiting for response..."}
            </pre>
            {totalTokens > 0 && !isStreaming && (
              <div className="new-skill-token-count">
                Tokens used: ~{totalTokens}
              </div>
            )}
          </div>
        )}

        {error &&
          (() => {
            const formatted = formatAIError(error);
            return (
              <div className="ai-error-message">
                <strong>{formatted.title}</strong>
                <span>{formatted.detail}</span>
              </div>
            );
          })()}

        <div className="new-skill-close-row">
          <button className="custom-ai-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

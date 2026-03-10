// §47 Skill Inline Test — run a Skill file against sample input
import { useCallback, useEffect, useState } from "react";

import { useLLMStream } from "../../hooks/use-llm-stream";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { formatAIError } from "../../utils/format-error";
import {
  extractSkillPrompt,
  runSkillTest,
} from "../../utils/skill-test-runner";

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
      <div
        className="new-skill-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560 }}
      >
        <h3 className="new-skill-title">Test Skill</h3>

        {requiredVars.length === 0 ? (
          <div
            style={{
              marginTop: 12,
              color: "var(--color-text-secondary)",
              fontSize: 13,
            }}
          >
            No template variables found in this Skill file. Make sure the
            current file contains {"<system>"} and/or {"<user>"} blocks with{" "}
            {`{{variable}}`} placeholders.
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {requiredVars.map((v) => (
              <div key={v} style={{ marginBottom: 12 }}>
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

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
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
          <div style={{ marginTop: 16 }}>
            <label className="custom-ai-label">Result</label>
            <pre
              style={{
                background: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                padding: 12,
                fontSize: 12,
                maxHeight: 300,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                marginTop: 4,
              }}
            >
              {text || "Waiting for response..."}
            </pre>
            {totalTokens > 0 && !isStreaming && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                }}
              >
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

        <div style={{ marginTop: 12, textAlign: "right" }}>
          <button className="custom-ai-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

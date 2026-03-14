// §45 Skill Auto-generation — modal dialog for AI-powered Skill file creation
import { useCallback, useState } from "react";

import { useLLMStream } from "../../hooks/use-llm-stream";
import { writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { formatAIError } from "../../utils/format-error";
import { logger } from "../../utils/logger";
import { buildSkillGenPrompts } from "../../utils/skill/skill-generator-prompt";

interface SkillGeneratorDialogProps {
  onClose: () => void;
  open: boolean;
}

const VARIABLE_OPTIONS = [
  "selection",
  "document",
  "input",
  "clipboard",
] as const;

export function SkillGeneratorDialog({
  open,
  onClose,
}: SkillGeneratorDialogProps) {
  const [description, setDescription] = useState("");
  const [selectedVars, setSelectedVars] = useState<Set<string>>(
    new Set(["input"]),
  );
  const [outputFormat, setOutputFormat] = useState<
    "json" | "markdown" | "text"
  >("text");
  const [preview, setPreview] = useState("");
  const { send, cancel, isStreaming, text, error } = useLLMStream();

  const toggleVar = useCallback((v: string) => {
    setSelectedVars((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }, []);

  const handleGenerate = useCallback(() => {
    if (!description.trim()) return;
    const { systemPrompt, userPrompt } = buildSkillGenPrompts({
      description: description.trim(),
      variables: Array.from(selectedVars),
      outputFormat,
    });
    setPreview("");
    send(userPrompt, systemPrompt);
  }, [description, selectedVars, outputFormat, send]);

  const handleCreate = useCallback(async () => {
    const content = preview || text;
    if (!content.trim()) return;

    const { rootPath } = useFileStore.getState();
    if (!rootPath) return;

    // Generate a filename from the description
    const safeName =
      description
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "new-skill";
    const filePath = `${rootPath}/skills/${safeName}.md`;

    try {
      await writeFile(filePath, content);
      // Open the new file in editor
      useFileStore.getState().setFileContent(filePath, content);
      useEditorStore.getState().openTab({
        id: crypto.randomUUID(),
        filePath,
        title: `${safeName}.md`,
        isDirty: false,
        isPinned: false,
      });
      onClose();
    } catch (err) {
      logger.error("[SkillGenerator] Failed to create skill file:", err);
    }
  }, [preview, text, description, onClose]);

  // Update preview when streaming completes
  const displayText = isStreaming ? text : preview || text;

  if (!open) return null;

  return (
    <div className="new-skill-overlay" onClick={onClose}>
      <div
        className="new-skill-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 560 }}
      >
        <h3 className="new-skill-title">Generate Skill with AI</h3>

        <div style={{ marginTop: 12 }}>
          <label className="custom-ai-label">Description</label>
          <textarea
            autoFocus
            className="custom-ai-prompt-input"
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this Skill should do..."
            rows={3}
            value={description}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="custom-ai-label">Template Variables</label>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {VARIABLE_OPTIONS.map((v) => (
              <label
                key={v}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 13,
                }}
              >
                <input
                  checked={selectedVars.has(v)}
                  onChange={() => toggleVar(v)}
                  type="checkbox"
                />
                {`{{${v}}}`}
              </label>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="custom-ai-label">Output Format</label>
          <select
            className="settings-select"
            onChange={(e) =>
              setOutputFormat(e.target.value as "json" | "markdown" | "text")
            }
            style={{ marginTop: 4 }}
            value={outputFormat}
          >
            <option value="text">Text</option>
            <option value="json">JSON</option>
            <option value="markdown">Markdown</option>
          </select>
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button
            className="custom-ai-btn custom-ai-btn-primary"
            disabled={!description.trim() || isStreaming}
            onClick={handleGenerate}
          >
            {isStreaming ? "Generating..." : "Generate"}
          </button>
          {isStreaming && (
            <button className="custom-ai-btn" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>

        {displayText && (
          <div style={{ marginTop: 16 }}>
            <label className="custom-ai-label">Preview</label>
            <pre
              className="skill-gen-preview"
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
              {displayText}
            </pre>
            {!isStreaming && displayText && (
              <button
                className="custom-ai-btn custom-ai-btn-primary"
                onClick={handleCreate}
                style={{ marginTop: 8 }}
              >
                Create Skill File
              </button>
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
